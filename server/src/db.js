import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(config.db.path);
export const db = new Database(config.db.path);

// WAL = ดีกว่าสำหรับ workload ที่มีทั้ง read กับ write บ่อยๆ
// และทนต่อ power loss ดีกว่า rollback journal
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');  // FULL = ปลอดภัยกว่าแต่ช้า; NORMAL พอสำหรับ WAL

function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

runSchema();

// ===== Helper functions =====

export const settings = {
  get(key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? fallback;
  },
  getNumber(key, fallback = 0) {
    const v = this.get(key);
    return v == null ? fallback : Number(v);
  },
  getBool(key, fallback = false) {
    const v = this.get(key);
    return v == null ? fallback : v === '1' || v === 'true';
  },
  set(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  },
};

export const coins = {
  // อะตอมิก: ป้องกัน race condition ระหว่าง read แล้ว update
  add(delta, reason = 'adjustment', byAdmin = null) {
    const tx = db.transaction((delta) => {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('coin_count', ?)
        ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?
      `).run(String(delta), delta);
      db.prepare(`
        INSERT INTO coin_refills (added_at, delta, reason, by_admin)
        VALUES (?, ?, ?, ?)
      `).run(Date.now(), delta, reason, byAdmin);
      return Number(db.prepare(`SELECT value FROM settings WHERE key='coin_count'`).get().value);
    });
    return tx(delta);
  },
  current() {
    return settings.getNumber('coin_count', 0);
  },
};

export const events = {
  log(level, source, message, data = null) {
    db.prepare(`
      INSERT INTO events (ts, level, source, message, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(Date.now(), level, source, message, data ? JSON.stringify(data) : null);
  },
  recent(limit = 100) {
    return db.prepare(`
      SELECT * FROM events ORDER BY ts DESC LIMIT ?
    `).all(limit);
  },
};

export const transactions = {
  start(billsTotal, coinsExpected) {
    const info = db.prepare(`
      INSERT INTO transactions (started_at, bills_total, coins_expected, status)
      VALUES (?, ?, ?, 'in_progress')
    `).run(Date.now(), billsTotal, coinsExpected);
    return info.lastInsertRowid;
  },
  updateDispensed(id, count) {
    db.prepare(`UPDATE transactions SET coins_dispensed = ? WHERE id = ?`).run(count, id);
  },
  complete(id, status = 'completed', error = null) {
    db.prepare(`
      UPDATE transactions
         SET completed_at = ?, status = ?, error = ?
       WHERE id = ?
    `).run(Date.now(), status, error, id);
  },
  recent(limit = 50) {
    return db.prepare(`SELECT * FROM transactions ORDER BY started_at DESC LIMIT ?`).all(limit);
  },
  // ใช้ตอน recovery หลัง crash/power loss
  findInProgress() {
    return db.prepare(`SELECT * FROM transactions WHERE status = 'in_progress'`).all();
  },
};
