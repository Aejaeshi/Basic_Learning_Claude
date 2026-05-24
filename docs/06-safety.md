# 06 — Safety, Reliability & Error Handling

> รวมกฎความปลอดภัย (ไฟฟ้า + software) + แนวทาง defensive coding

---

## 1. Hardware Safety ⚡ (สำคัญที่สุด)

### 1.1 Rules ห้ามฝ่าฝืน
| Rule | เหตุผล | ถ้าฝ่าฝืน |
|---|---|---|
| สัญญาณ ≥ 5V เข้า ESP32 ต้องผ่าน optocoupler | ESP32 รับแค่ 3.3V | พังทันที |
| Motor (inductive) ต้องมี flyback diode | สนามแม่เหล็กยุบเกิด spike >100V | MOSFET พัง 1-2 ครั้ง |
| MOSFET ต้องเป็น logic-level (Vgs(th)<3V) | ESP32 ส่ง 3.3V เปิดไม่เต็ม | MOSFET ร้อน, พัง |
| Gate ของ MOSFET ต้องมี pull-down | ตอน ESP32 boot, gate ลอย → motor กระตุก | hopper หมุนผิดเวลา |
| ทุกตัวต้องมี common GND | floating ground = สัญญาณเพี้ยน | นับ pulse ผิด |
| PSU 24V ขั้นต่ำ 5A | hopper peak ~3A + headroom | brown-out reset |
| ESP32 มี cap decoupling 1000µF | กันแรงดันตกตอน motor start | ESP32 reset |
| สาย AC 220V แยกออกจากสาย signal | EMI + ปลอดภัยคน | นับ pulse ผิด + อันตราย |

### 1.2 Fuse + Breaker
- AC input: fuse 5A
- DC 24V: fuse 5A หลัง PSU
- DC 12V: fuse 1A
- 5V (ESP32): ไม่จำเป็น (USB มีแล้ว)
- Earth ground: ต่อตัวกล่อง metal เข้ากับ earth ของปลั๊ก

### 1.3 การตรวจ ก่อนเปิดไฟครั้งแรก
1. ✅ ดูสายไฟ AC ไม่หลวม, ไม่มีปลายโผล่
2. ✅ Multimeter วัด short ระหว่าง L-N, L-GND, N-GND → ต้องไม่ short
3. ✅ ไม่ได้สลับขั้ว PSU
4. ✅ Polarity ของ flyback diode ถูก (cathode ไป + ของ rail)
5. ✅ Polarity ของ optocoupler LED ถูก (anode ไป +)
6. ✅ ESP32 ไม่ได้เสียบไฟพร้อมกัน 2 ทาง (Vin + USB)
7. ✅ ติดฮีตซิงค์ MOSFET (เผื่อ stall current)

---

## 2. Software Safety

### 2.1 ESP32 firmware

**Watchdog Hardware:**
```cpp
#include <esp_task_wdt.h>

void setup() {
  esp_task_wdt_init(10, true);  // 10s timeout, panic on trigger
  esp_task_wdt_add(NULL);
}

void loop() {
  esp_task_wdt_reset();         // feed watchdog ทุก iteration
  // ...
}
```
> ถ้า loop ค้าง 10 วินาที → ESP32 reset เอง

**ISR ห้าม:**
- ❌ ห้าม `Serial.print` ใน ISR
- ❌ ห้าม `delay()`, `millis()` ใน ISR (millis ใช้ได้แต่ระวัง)
- ❌ ห้าม allocate memory (`new`, `malloc`, `String`)
- ❌ ห้าม access non-`volatile` shared variable โดยไม่มี protection

**ISR ทำได้:**
- ✅ เพิ่ม `volatile uint32_t` counter
- ✅ Set flag `volatile bool`
- ✅ ใช้ `portENTER_CRITICAL_ISR` ถ้าต้อง atomic

**ตัวอย่าง pulse ที่ปลอดภัย:**
```cpp
volatile uint32_t pulseCount = 0;
volatile uint32_t lastPulseUs = 0;

void IRAM_ATTR onPulse() {
  uint32_t now = micros();
  if (now - lastPulseUs > 30000) {  // debounce 30ms
    pulseCount++;
    lastPulseUs = now;
  }
}

// อ่านอย่างปลอดภัยใน main loop:
uint32_t readAndReset() {
  noInterrupts();
  uint32_t v = pulseCount;
  pulseCount = 0;
  interrupts();
  return v;
}
```

**ห้าม:**
- ❌ `String` class → heap fragmentation
- ❌ `delay()` ใน loop หลัก
- ❌ Recursive function ยาวๆ (stack overflow)
- ❌ Block ใน main loop (เช่น รอ Serial response)

### 2.2 PC Backend

**Always-on Restart:**
```ini
# systemd
Restart=always
RestartSec=3
StartLimitBurst=10
```

**Graceful Shutdown:**
```javascript
process.on('SIGTERM', async () => {
  await esp32.send('disable_all');  // ปิด NK77 ก่อน
  await db.close();
  process.exit(0);
});
```

**Database transaction ก่อน dispense:**
```javascript
// ⚠️ สำคัญ: log ก่อนสั่ง dispense
db.prepare(`
  INSERT INTO transactions (started_at, bills_total, coins_to_dispense, status)
  VALUES (?, ?, ?, 'dispensing')
`).run(Date.now(), 100, 10);

const txnId = db.lastInsertRowid;
esp32.send('dispense', { coins: 10 });
// ... รอ dispense_done แล้ว update status
```

> 💡 ถ้าไฟดับหลัง insert แต่ก่อน done → DB มี row status='dispensing' → recovery script รู้ว่าค้าง

**Idempotent operations:**
- coin_count update ต้องเป็น atomic (`UPDATE ... WHERE current = ?`)
- ไม่ใช้ "read → modify → write" แบบ race-prone

### 2.3 Web Admin Security

**Password:**
```javascript
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 12);
// store hash, never plain
```

**Session:**
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,  // จาก .env, random 64 bytes
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 30*60*1000 },
  resave: false,
  saveUninitialized: false
}));
```

**Rate limit:**
```javascript
const rateLimit = require('express-rate-limit');
app.use('/admin/login', rateLimit({ windowMs: 60000, max: 5 }));
```

**Audit log:**
- ทุก admin action → INSERT INTO events
- ใครเข้า / กดอะไร / เปลี่ยนค่าจาก-เป็น

---

## 3. Error Handling Matrix

| Component | Error | Detect | Recovery |
|---|---|---|---|
| NK77 | ไม่ส่ง pulse แม้ใส่แบงค์ | ดูจาก hardware (LED NK77) | ตรวจไฟเลี้ยง, ตรวจสาย |
| NK77 | ส่ง pulse แต่ผิดจำนวน | เทียบกับ display NK77 | ปรับ DIP switch รุ่น NK77 |
| NK77 INH | ปิดแบงค์ไม่ทำงาน | NK77 ยังรับแบงค์ที่สั่งปิด | ตรวจ optocoupler |
| Hopper | สั่งหมุน แต่ไม่หมุน | LG-JT02 ไม่ส่ง pulse ใน 3s | timeout → emergency stop → alert |
| Hopper | หมุนแต่ไม่ออกเหรียญ | sensor ไม่ตอบใน 3s | jam, ต้องเปิดดู |
| Hopper | ออกเหรียญผิด (2 อันพร้อมกัน) | LG-JT02 พลาด, count ไม่ตรง | log discrepancy, alert |
| LG-JT02 | False positive (noise) | ได้ pulse ตอนไม่ได้สั่ง | ตรวจ wiring, เพิ่ม debounce |
| LG-JT02 | ตาย (อ่านไม่ได้) | ทุก dispense fail | ทดสอบเปลี่ยน sensor |
| ESP32 | crash / reset | PC ขาด heartbeat | systemd restart? ไม่ — ตัวมัน reset เอง ผ่าน watchdog |
| ESP32 | flash corruption | weird behavior | re-flash firmware |
| PC | crash | ESP32 watchdog → inhibit | systemd restart Node |
| PC | DB ล็อก / เต็ม | INSERT fail | log to file, alert |
| Browser | crash / freeze | Chromium auto-restart? | ใช้ `chromium --restore-last-session` หรือ wrapper script |
| Network | Discord webhook fail | HTTP non-2xx | retry 3 ครั้ง, ถ้ายังพลาด log |

---

## 4. Power Loss Scenarios

### 4.1 ไฟดับขณะ IDLE
- ไม่มีอะไรเสียหาย
- เมื่อไฟกลับมา → PC boot → Node start → resume

### 4.2 ไฟดับขณะ RECEIVING
- ลูกค้าใส่ไป X บาท
- NK77 อาจ "เก็บ" แบงค์ไว้แล้ว (เข้ากล่อง)
- DB ไม่ได้ insert (ยังไม่ commit transaction)
- **ผลลัพธ์: เงินในกล่อง NK77 แต่ไม่มีบันทึก, ลูกค้าได้เปล่า**
- **ป้องกัน:** UPS, log pulse ทันที (ไม่รอจบ session)

### 4.3 ไฟดับขณะ DISPENSING (เหรียญออกไป 5 จาก 10)
- DB มี row status='dispensing', coins_dispensed=5 (อัปเดตทุก coin)
- Hopper หยุดทันที (ไฟไม่มี)
- **เมื่อไฟกลับมา:**
  - Recovery script detect row 'dispensing' → set status='power_loss_recovered'
  - แสดง alert ให้ admin ตรวจ
  - Admin manual dispense ส่วนที่เหลือผ่าน test dispense

### 4.4 ทางป้องกันที่ดีที่สุด
- **UPS 600VA** (1500-2500฿) สำหรับ PC
- PC จะมีเวลา 5-10 นาที → ทำ graceful shutdown
- ESP32 + hopper ดับได้ทันที ไม่เสียหาย

---

## 5. Race Conditions

### 5.1 PC: dispense ซ้ำซ้อน
```javascript
// ❌ BAD
async function onBillTimerExpire() {
  esp32.send('dispense', { coins: pendingCoins });
}
// ถ้า timer expire 2 ครั้งใกล้ๆ → dispense 2 ครั้ง

// ✅ GOOD
let dispensing = false;
async function onBillTimerExpire() {
  if (dispensing) return;
  dispensing = true;
  try {
    esp32.send('dispense', { coins: pendingCoins });
    await waitForDispenseDone();
  } finally {
    dispensing = false;
  }
}
```

### 5.2 ESP32: pulse นับซ้ำ
- ใช้ debounce 30ms ใน ISR (เห็นใน 2.1)
- ใช้ `attachInterruptArg` ถ้าต้องส่ง context

### 5.3 DB: coin_count update concurrent
```sql
-- ❌ BAD (race)
SELECT value FROM settings WHERE key='coin_count';  -- ได้ 100
UPDATE settings SET value=90 WHERE key='coin_count';

-- ✅ GOOD (atomic)
UPDATE settings SET value=value-10 WHERE key='coin_count';
```

---

## 6. Defensive Coding Checklist

### ESP32
- [ ] ทุก ISR มี `IRAM_ATTR`
- [ ] ทุก variable แชร์กับ ISR เป็น `volatile`
- [ ] ทุก critical section ใช้ `noInterrupts()/interrupts()`
- [ ] Watchdog feed ใน main loop
- [ ] ไม่มี `delay()`, `String`, `new`
- [ ] Pin output set initial state ใน setup
- [ ] Boot → ทุก INHIBIT pin = active (disable แบงค์) ก่อน PC พร้อม
- [ ] Reset reason logged ส่งใน `hello`

### Node.js
- [ ] DB transaction ทุก state change
- [ ] Try/catch ใน serialport callbacks
- [ ] Reconnect logic เมื่อ USB หาย
- [ ] Process error handlers (uncaughtException, unhandledRejection)
- [ ] Graceful shutdown (SIGTERM)
- [ ] Log rotation (logrotate หรือ pino-roll)
- [ ] .env file permission 600
- [ ] Discord webhook retry with backoff

### Browser
- [ ] WebSocket auto-reconnect
- [ ] Visibility API → pause animation เมื่อหน้าจอ off (ประหยัด CPU)
- [ ] No console.log ใน production
- [ ] Disable right-click + F12 + key shortcuts (กันลูกค้ามือบอน)

---

## 7. Acceptance Tests ก่อนใช้งานจริง

### 7.1 Smoke Test (15 นาที)
- [ ] Boot PC + ESP32 → state = IDLE
- [ ] ใส่ 20฿ → จ่าย 2 เหรียญ
- [ ] ใส่ 100฿ → จ่าย 10 เหรียญ
- [ ] Discord ได้รับ daily summary
- [ ] Admin login + ดู log

### 7.2 Stress Test (1 ชั่วโมง)
- [ ] ใส่ 1000฿ จ่าย 100 เหรียญ ติดต่อกัน 5 รอบ → coin_count ตรง
- [ ] ดึงสาย USB กลางทาง → ESP32 inhibit ใน 5s → จอแสดง error → เสียบกลับ → resume
- [ ] reboot PC ขณะ DISPENSING (จำลองไฟดับ) → boot → recovery alert
- [ ] กด admin "Test Dispense 1" 50 ครั้ง → ออกเหรียญละ 1 ครบ

### 7.3 Fault Injection
- [ ] ปลด LG-JT02 → dispense → timeout 3s → alert
- [ ] ปลด NK77 pulse line → ใส่แบงค์ → ไม่มี response (state ไม่เปลี่ยน) → OK
- [ ] ใส่แบงค์ปลอม → NK77 ปฏิเสธ (ไม่มี pulse) → OK
- [ ] Set coin_count = 5 → ใส่ 1000฿ → NK77 ปฏิเสธแบงค์ (inhibited)

### 7.4 Long-running Test
- [ ] ทิ้งให้รัน 24 ชม. (ไม่มีลูกค้า) → ดู memory leak, log volume
- [ ] Heartbeat สม่ำเสมอตลอด 24 ชม.
- [ ] ESP32 free heap ไม่ลดลง

---

## 8. สิ่งที่ Claude ต้องเตือนเสมอ (Reminders)

เมื่อเห็นใน code/ design ต่อไปนี้ → **เตือนทันที**:

| เห็น | เตือน |
|---|---|
| `delay()` ใน loop ESP32 | ⚠️ ใช้ millis() pattern แทน |
| `String s = ...` ใน firmware | ⚠️ heap fragmentation, ใช้ `char[N]` |
| `digitalRead(pin)` ของสัญญาณ 12V ไม่มี optocoupler | ⚠️ ESP32 พัง |
| `digitalWrite` motor 24V ไม่มี MOSFET | ⚠️ pin พัง |
| MOSFET ไม่มี flyback diode | ⚠️ MOSFET พัง |
| ไม่ feed watchdog | ⚠️ ESP32 ค้าง |
| dispense ก่อน log DB | ⚠️ data loss ตอนไฟดับ |
| password plain text | ⚠️ security |
| webhook URL ใน code | ⚠️ ย้ายไป .env |
| `INSERT/UPDATE` แยก 2 query (ควร atomic) | ⚠️ race condition |
| Admin endpoint ไม่มี auth check | ⚠️ ใครก็เข้าได้ |
| ทำ async แต่ไม่มี try/catch | ⚠️ unhandled rejection |
| ลูกค้า input ใน admin page (เช่น search) → ใส่ SQL ตรง | ⚠️ SQL injection — ต้อง parameterized |
