-- Coin Exchange — SQLite schema
-- ใช้ better-sqlite3 รัน statement ทีละตัวตอน boot (idempotent ด้วย IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,          -- ms epoch
  completed_at    INTEGER,                   -- ms epoch (NULL ถ้ายังไม่จบ)
  bills_total     INTEGER NOT NULL DEFAULT 0,-- บาท
  coins_expected  INTEGER NOT NULL DEFAULT 0,
  coins_dispensed INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,             -- 'in_progress' | 'completed' | 'jammed' | 'aborted' | 'power_loss_recovered'
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_started_at ON transactions(started_at);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

CREATE TABLE IF NOT EXISTS coin_refills (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  added_at  INTEGER NOT NULL,
  delta     INTEGER NOT NULL,                -- +/- (เติม/ลด)
  reason    TEXT,                            -- 'refill' | 'adjustment' | 'initial'
  by_admin  TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,                -- ms epoch
  level     TEXT NOT NULL,                   -- 'info' | 'warn' | 'error'
  source    TEXT NOT NULL,                   -- 'esp32' | 'pc' | 'admin' | 'system'
  message   TEXT NOT NULL,
  data      TEXT                             -- JSON string
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ค่าเริ่มต้น (UPSERT) — ใช้ INSERT OR IGNORE เพื่อไม่ทับค่าเดิม
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('coin_count', '0'),
  ('low_coin_threshold', '100'),
  ('inhibit_20', '0'),
  ('inhibit_50', '0'),
  ('inhibit_100', '0'),
  ('inhibit_500', '0'),
  ('inhibit_1000', '0'),
  ('machine_disabled', '0');
