import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateConfig } from './config.js';
import { db, settings, coins, events, transactions } from './db.js';
import { createEsp32 } from './esp32/index.js';
import { Machine } from './machine.js';
import { attachWebSocket } from './ws.js';
import { createDevRouter } from './routes/dev.js';

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

esp32.on('connected', () => events.log('info', 'esp32', 'connected'));
esp32.on('disconnected', () => events.log('warn', 'esp32', 'disconnected'));

machine.on('low_coin', ({ remaining, threshold }) => {
  console.log(`⚠️  Low coin: ${remaining} (threshold ${threshold})`);
  // TODO: Discord webhook ใน Phase ถัดไป
});

// ===== Express app =====
const app = express();
app.use(express.json());

// Static files: หน้าจอลูกค้า + (เร็วๆ นี้) admin
app.use('/customer', express.static(path.join(PUBLIC_DIR, 'customer')));
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
