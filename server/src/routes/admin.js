import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, loginRateLimit, verifyCredentials } from '../auth.js';
import { config } from '../config.js';
import { coins, settings, events, transactions } from '../db.js';
import { discord } from '../discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.join(__dirname, '..', '..', 'public', 'admin');

/**
 * Admin routes
 *
 * Public:
 *   GET  /admin/login        login page
 *   POST /admin/login        verify, set session
 *
 * Protected (requireAuth):
 *   GET  /admin/             dashboard page
 *   POST /admin/logout       clear session
 *   GET  /admin/api/state    current state snapshot
 *   POST /admin/api/coins    body: { delta: 100 } or { set: 500 }
 *   POST /admin/api/inhibit  body: { denom: 1000, on: true }
 *   POST /admin/api/disable  body: { disabled: true }
 *   POST /admin/api/clear-error
 *   POST /admin/api/test-dispense  body: { coins: 1 }
 *   POST /admin/api/test-discord   ส่ง test message ไป Discord webhook
 *   POST /admin/api/settings body: { low_coin_threshold: 100 }
 *   GET  /admin/api/transactions?limit=50
 *   GET  /admin/api/events?limit=100
 */
export function createAdminRouter(machine, esp32) {
  const router = Router();

  // ===== Public =====

  router.get('/login', (req, res) => {
    if (req.session?.admin) return res.redirect('/admin/');
    res.sendFile(path.join(ADMIN_DIR, 'login.html'));
  });

  router.post('/login', loginRateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username + password required' });
    }
    const ok = await verifyCredentials(username, password);
    if (!ok) {
      events.log('warn', 'admin', 'login_failed', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.admin = { username, loggedInAt: Date.now() };
    events.log('info', 'admin', 'login_success', { username, ip: req.ip });
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const username = req.session?.admin?.username;
    req.session.destroy(() => {
      res.clearCookie('coin.sid');
      if (username) events.log('info', 'admin', 'logout', { username });
      res.json({ ok: true });
    });
  });

  // ===== Protected =====

  router.use(requireAuth);

  router.get('/', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));

  router.get('/api/state', (req, res) => {
    res.json({
      ...machine.getState(),
      inhibits: Object.fromEntries(
        config.business.validDenoms.map(d => [d, settings.getBool(`inhibit_${d}`)])
      ),
      machineDisabled: settings.getBool('machine_disabled'),
      admin: req.session.admin,
    });
  });

  router.post('/api/coins', (req, res) => {
    const { delta, set: setValue, reason = 'admin_adjust' } = req.body || {};
    const adminName = req.session.admin.username;
    let remaining;
    if (typeof setValue === 'number') {
      const current = coins.current();
      remaining = coins.add(setValue - current, reason, adminName);
    } else if (typeof delta === 'number') {
      if (!Number.isInteger(delta)) {
        return res.status(400).json({ error: 'delta must be integer' });
      }
      remaining = coins.add(delta, reason, adminName);
    } else {
      return res.status(400).json({ error: 'Provide "delta" or "set"' });
    }
    machine._applyInhibits();  // อาจเปลี่ยน inhibit state เพราะเหรียญเปลี่ยน
    machine._emitStateChange();
    res.json({ ok: true, coin_count: remaining });
  });

  router.post('/api/inhibit', (req, res) => {
    const { denom, on } = req.body || {};
    if (!config.business.validDenoms.includes(Number(denom))) {
      return res.status(400).json({ error: 'invalid denom' });
    }
    settings.set(`inhibit_${denom}`, on ? '1' : '0');
    events.log('info', 'admin', 'inhibit_change', {
      denom, on, by: req.session.admin.username,
    });
    machine._applyInhibits();
    machine._emitStateChange();
    res.json({ ok: true });
  });

  router.post('/api/disable', (req, res) => {
    const { disabled } = req.body || {};
    if (disabled) machine.disable(); else machine.enable();
    events.log('info', 'admin', disabled ? 'machine_disabled' : 'machine_enabled', {
      by: req.session.admin.username,
    });
    res.json({ ok: true, disabled: !!disabled });
  });

  router.post('/api/clear-error', (req, res) => {
    machine.clearError();
    events.log('info', 'admin', 'error_cleared', { by: req.session.admin.username });
    res.json({ ok: true });
  });

  router.post('/api/test-dispense', (req, res) => {
    const n = Number(req.body?.coins);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return res.status(400).json({ error: 'coins must be integer 1-10' });
    }
    // ⚠️ ใช้ตอน admin เท่านั้น — bypass state machine, ส่งตรงไป ESP32
    // แต่ก็หัก coin_count เหมือนการจ่ายปกติ
    const available = coins.current();
    if (available < n) {
      return res.status(400).json({ error: `coin_count = ${available}, need ${n}` });
    }
    coins.add(-n, 'test_dispense', req.session.admin.username);
    esp32.send({ type: 'cmd', name: 'dispense', coins: n });
    events.log('info', 'admin', 'test_dispense', {
      coins: n, by: req.session.admin.username,
    });
    res.json({ ok: true });
  });

  router.post('/api/settings', (req, res) => {
    const allowed = ['low_coin_threshold'];
    const updates = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!allowed.includes(key)) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      settings.set(key, n);
      updates[key] = n;
    }
    events.log('info', 'admin', 'settings_update', {
      updates, by: req.session.admin.username,
    });
    machine._emitStateChange();
    res.json({ ok: true, updated: updates });
  });

  router.post('/api/test-discord', async (req, res) => {
    if (!discord.enabled) {
      return res.status(400).json({ error: 'DISCORD_WEBHOOK_URL ยังไม่ได้ตั้งใน .env' });
    }
    const ok = await discord.test();
    events.log('info', 'admin', 'discord_test', {
      ok, by: req.session.admin.username,
    });
    res.json({ ok });
  });

  router.get('/api/transactions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ transactions: transactions.recent(limit) });
  });

  router.get('/api/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    res.json({ events: events.recent(limit) });
  });

  return router;
}
