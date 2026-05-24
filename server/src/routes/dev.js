import { Router } from 'express';

/**
 * Dev routes — เปิดเฉพาะ NODE_ENV !== 'production'
 *
 * ใช้สำหรับ test backend โดยไม่ต้องมี ESP32 จริง
 * - POST /dev/inject-bill  body: { amount: 10 }
 * - POST /dev/inject-coin
 * - POST /dev/inject-error body: { code, message }
 * - POST /dev/send-cmd     body: { cmd object }
 */
export function createDevRouter(esp32) {
  const router = Router();

  router.post('/inject-bill', (req, res) => {
    if (typeof esp32.injectBillPulse !== 'function') {
      return res.status(400).json({ error: 'Not in mock mode' });
    }
    const amount = Number(req.body?.amount ?? 10);
    esp32.injectBillPulse(amount);
    res.json({ ok: true, injected: { name: 'bill_pulse', amount } });
  });

  router.post('/inject-coin', (req, res) => {
    if (typeof esp32.injectCoinDispensed !== 'function') {
      return res.status(400).json({ error: 'Not in mock mode' });
    }
    esp32.injectCoinDispensed();
    res.json({ ok: true, injected: { name: 'coin_dispensed' } });
  });

  router.post('/inject-error', (req, res) => {
    if (typeof esp32.injectError !== 'function') {
      return res.status(400).json({ error: 'Not in mock mode' });
    }
    const { code = 'TEST_ERROR', message = 'injected from /dev' } = req.body || {};
    esp32.injectError(code, message);
    res.json({ ok: true, injected: { code, message } });
  });

  router.post('/send-cmd', (req, res) => {
    const cmd = req.body;
    if (!cmd?.type || !cmd?.name) {
      return res.status(400).json({ error: 'cmd must have type + name' });
    }
    const sent = esp32.send(cmd);
    res.json({ ok: sent });
  });

  router.get('/state', (req, res) => {
    res.json({
      connected: esp32.connected,
      mock: typeof esp32.injectBillPulse === 'function',
    });
  });

  return router;
}
