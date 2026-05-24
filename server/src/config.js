import 'dotenv/config';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 8080),
  isProduction: process.env.NODE_ENV === 'production',

  esp32: {
    mode: process.env.ESP32_MODE || 'mock',
    port: process.env.ESP32_PORT || '/dev/ttyUSB0',
    baud: num(process.env.ESP32_BAUD, 115200),
  },

  business: {
    coinValueBaht: num(process.env.COIN_VALUE_BAHT, 10),
    billTimeoutMs: num(process.env.BILL_TIMEOUT_MS, 2000),
    lowCoinThreshold: num(process.env.LOW_COIN_THRESHOLD, 100),
    validDenoms: [20, 50, 100, 500, 1000],
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  },

  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    dailySummaryHour: num(process.env.DISCORD_DAILY_SUMMARY_HOUR, 23),
  },

  db: {
    path: process.env.DB_PATH || './data/coin.db',
  },
};

// Validate ก่อน start ใน production
export function validateConfig() {
  const errors = [];
  if (config.isProduction) {
    if (!config.admin.passwordHash) errors.push('ADMIN_PASSWORD_HASH ต้องตั้งใน production');
    if (config.admin.sessionSecret === 'dev-only-insecure-secret') {
      errors.push('SESSION_SECRET ต้องเปลี่ยนเป็น random hex 64 ตัวอักษร');
    }
    if (!config.discord.webhookUrl) {
      console.warn('⚠️  DISCORD_WEBHOOK_URL ไม่ได้ตั้ง — ระบบจะไม่แจ้งเตือน');
    }
  }
  if (errors.length) {
    throw new Error('Config invalid:\n  - ' + errors.join('\n  - '));
  }
}
