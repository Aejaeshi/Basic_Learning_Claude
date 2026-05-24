/**
 * Discord webhook notifier
 *
 * ใช้แจ้งเตือนผ่าน Discord channel:
 *   - เหรียญใกล้หมด (low_coin)
 *   - เครื่องผิดปกติ (error_occurred)
 *   - ESP32 หลุด/กลับมา (esp32_disconnect/connect)
 *   - สรุปยอดรายวัน (daily_summary)
 *
 * Features:
 *   - ถ้า DISCORD_WEBHOOK_URL ว่าง → skip ทุก notification (ไม่ throw)
 *   - Dedupe: ห้ามส่ง message key เดียวกันซ้ำใน 5 นาที (กัน spam)
 *   - Timeout 8 วินาที + log error ลง DB เมื่อยิงไม่ติด
 *   - Embed สีแยกชัด: เหลือง=warn / แดง=error / เขียว=info / น้ำเงิน=summary
 */

import { config } from './config.js';
import { events } from './db.js';

const ENABLED = !!config.discord.webhookUrl;
const DEDUPE_MS = 5 * 60 * 1000;       // 5 นาที
const sentRecently = new Map();        // key → timestamp

// สี embed (Discord ใช้ decimal integer)
const COLOR = Object.freeze({
  WARN:    0xfbbf24,  // amber-400
  ERROR:   0xef4444,  // red-500
  SUCCESS: 0x10b981,  // emerald-500
  INFO:    0x3b82f6,  // blue-500
});

async function postWebhook(payload) {
  if (!ENABLED) return false;
  try {
    const res = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      events.log('warn', 'discord', 'webhook_failed', { status: res.status, body: body.slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    events.log('error', 'discord', 'webhook_error', { message: err.message });
    return false;
  }
}

function shouldSkip(key) {
  const now = Date.now();
  const last = sentRecently.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  sentRecently.set(key, now);
  // cleanup entries เก่า กันโตเรื่อยๆ
  for (const [k, t] of sentRecently) {
    if (now - t > DEDUPE_MS) sentRecently.delete(k);
  }
  return false;
}

function embedBase(title, description, color) {
  return {
    title,
    description,
    color,
    timestamp: new Date().toISOString(),
    footer: { text: 'ตู้แลกเหรียญ' },
  };
}

export const discord = {
  get enabled() { return ENABLED; },

  /** ส่งข้อความ plain — ใช้ตอน test หรือ debug */
  async send(content) {
    return postWebhook({ content });
  },

  async notifyLowCoin({ remaining, threshold }) {
    if (shouldSkip('low_coin')) return false;
    return postWebhook({
      embeds: [embedBase(
        '⚠️ เหรียญใกล้หมด',
        `เหลือ **${remaining}** เหรียญ (threshold: ${threshold})\nรีบเติมก่อนหยุดรับธนบัตรอัตโนมัติ`,
        COLOR.WARN,
      )],
    });
  },

  async notifyError({ message }) {
    // dedupe ตาม error message — ถ้า error เดิมยิงรัวๆ จะส่งครั้งเดียวต่อ 5 นาที
    if (shouldSkip(`error:${message}`)) return false;
    return postWebhook({
      embeds: [embedBase(
        '🚨 เครื่องอยู่ในสถานะ ERROR',
        message,
        COLOR.ERROR,
      )],
    });
  },

  async notifyEsp32(connected) {
    // dedupe แยก connect/disconnect — ป้องกัน flap แล้วยิงรัวๆ
    const key = connected ? 'esp32_up' : 'esp32_down';
    if (shouldSkip(key)) return false;
    return postWebhook({
      embeds: [embedBase(
        connected ? '✅ ESP32 กลับมาแล้ว' : '🔌 ESP32 หลุดการเชื่อมต่อ',
        connected ? 'การสื่อสารกับ controller ปกติ' : 'PC ไม่ได้รับ heartbeat จาก ESP32 — เครื่องจะหยุดรับธนบัตรอัตโนมัติ',
        connected ? COLOR.SUCCESS : COLOR.ERROR,
      )],
    });
  },

  async notifyDailySummary(s) {
    // ไม่ dedupe — รันวันละครั้งอยู่แล้ว
    const fields = [
      { name: 'Transactions',      value: String(s.totalTxns),    inline: true },
      { name: 'รับเงิน',           value: `${s.totalBills} ฿`,    inline: true },
      { name: 'จ่ายเหรียญ',        value: `${s.totalCoins} เหรียญ`, inline: true },
      { name: 'เหรียญในตู้ตอนนี้', value: String(s.currentCoins), inline: true },
      { name: 'Jammed/Error',      value: String(s.errors),       inline: true },
    ];
    return postWebhook({
      embeds: [{
        title: `📊 สรุปยอดวันที่ ${s.date}`,
        color: COLOR.INFO,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'ตู้แลกเหรียญ' },
      }],
    });
  },

  /** ใช้จากปุ่ม "Test Discord" ใน admin UI */
  async test() {
    return postWebhook({
      embeds: [embedBase(
        '✅ Test message',
        'Discord webhook ทำงานปกติ — พร้อมรับการแจ้งเตือนจากตู้แลกเหรียญ',
        COLOR.SUCCESS,
      )],
    });
  },
};
