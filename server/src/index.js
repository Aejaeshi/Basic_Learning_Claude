import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateConfig } from './config.js';
import { db, settings, coins, events, transactions } from './db.js';
import { createEsp32 } from './esp32/index.js';
import { Machine } from './machine.js';
import { attachWebSocket } from './ws.js';
import { createDevRouter } from './routes/dev.js';
import { createAdminRouter } from './routes/admin.js';
import { sessionMiddleware } from './auth.js';
import { discord } from './discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

validateConfig();

// Recovery: ตรวจ transaction ที่ค้างจากครั้งก่อน (กรณี crash/ไฟดับ)
const stale = transactions.findInProgress();
if (stale.length > 0) {
  for (const t of stale) {
    transactions.complete(t.id, 'power_loss_recovered', 'PC restart while in_progress');
    events.log('warn', 'system', 'recovered_stale_transaction', t);
  }
  console.warn(`⚠️  Recovered ${stale.length} stale transaction(s) from previous run`);
}

// ===== ESP32 + Machine =====
const esp32 = createEsp32();
const machine = new Machine(esp32);

esp32.on('connected', () => {
  events.log('info', 'esp32', 'connected');
  discord.notifyEsp32(true);
});
esp32.on('disconnected', () => {
  events.log('warn', 'esp32', 'disconnected');
  discord.notifyEsp32(false);
});

machine.on('low_coin', ({ remaining, threshold }) => {
  console.log(`⚠️  Low coin: ${remaining} (threshold ${threshold})`);
  discord.notifyLowCoin({ remaining, threshold });
});

machine.on('error_occurred', ({ message }) => {
  console.error(`🚨 Machine error: ${message}`);
  discord.notifyError({ message });
});

// ===== Daily summary scheduler =====
// เช็คทุก 1 นาที — ถึงชั่วโมงที่ตั้งไว้ + ยังไม่ส่งวันนี้ → ยิง summary แล้ว mark วันที่ลง settings
async function maybeSendDailySummary() {
  const now = new Date();
  if (now.getHours() !== config.discord.dailySummaryHour) return;
  const today = now.toISOString().slice(0, 10);   // YYYY-MM-DD
  if (settings.get('discord_last_summary_date') === today) return;

  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const s = transactions.summary(startOfDay.getTime(), endOfDay.getTime() + 1);
  const ok = await discord.notifyDailySummary({
    date: today,
    currentCoins: coins.current(),
    ...s,
  });
  if (ok) {
    settings.set('discord_last_summary_date', today);
    events.log('info', 'discord', 'daily_summary_sent', { date: today, ...s });
  }
}
if (discord.enabled) {
  setInterval(maybeSendDailySummary, 60_000);
  console.log(`📣 Discord webhook enabled — daily summary at ${config.discord.dailySummaryHour}:00`);
} else {
  console.log('📣 Discord webhook disabled (DISCORD_WEBHOOK_URL ว่าง)');
}

// ===== Express app =====
const app = express();
app.use(express.json());
app.use(sessionMiddleware);

// Trust proxy ถ้าอยู่หลัง reverse proxy (เช่น nginx) — สำคัญสำหรับ rate limit ตาม IP
// app.set('trust proxy', 1);

// Static files: หน้าจอลูกค้า + admin (login page เปิดให้ทุกคนเข้า, ที่อื่นมี auth)
app.use('/customer', express.static(path.join(PUBLIC_DIR, 'customer')));
app.use('/admin/app.js', express.static(path.join(PUBLIC_DIR, 'admin', 'app.js')));
app.use('/admin', createAdminRouter(machine, esp32));
app.get('/', (req, res) => res.redirect('/customer/'));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    esp32_connected: esp32.connected,
    machine_state: machine.state,
    coin_count: coins.current(),
    machine_disabled: settings.getBool('machine_disabled'),
  });
});

// Public — เปิดให้ central dashboard (อนาคต) discover ตู้นี้ได้โดยไม่ต้อง login
// ห้าม return อะไรที่เป็น secret — เปิด public ทั้ง LAN
const SERVER_STARTED_AT = Date.now();
let PKG_VERSION = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  PKG_VERSION = pkg.version || 'unknown';
} catch { /* ignore */ }

app.get('/api/machine-info', (req, res) => {
  res.json({
    id:             config.machine.id,
    name:           config.machine.name,
    branch:         config.machine.branch,
    version:        PKG_VERSION,
    state:          machine.state,
    esp32Connected: esp32.connected,
    coinCount:      coins.current(),
    machineDisabled: settings.getBool('machine_disabled'),
    startedAt:      SERVER_STARTED_AT,
    uptime:         Date.now() - SERVER_STARTED_AT,
  });
});

// Dev tools (เฉพาะนอก production)
if (!config.isProduction) {
  app.use('/dev', createDevRouter(esp32));
  console.log('🛠  Dev endpoints enabled at /dev/*');
}

// ===== HTTP + WebSocket =====
const server = app.listen(config.port, () => {
  console.log(`🚀 Server listening on http://localhost:${config.port}`);
  console.log(`   หน้าจอลูกค้า: http://localhost:${config.port}/customer/`);
  console.log(`   ESP32 mode:   ${config.esp32.mode}`);
  console.log(`   Coin count:   ${coins.current()}`);
});

attachWebSocket(server, machine);

// ===== Graceful shutdown =====
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  esp32.send({ type: 'cmd', name: 'disable_all' });
  esp32.close();
  server.close(() => {
    db.close();
    console.log('Bye 👋');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught:', err);
  events.log('error', 'pc', 'uncaughtException', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  events.log('error', 'pc', 'unhandledRejection', { reason: String(reason) });
});
