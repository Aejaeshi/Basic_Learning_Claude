# 04 — JSON Serial Protocol Spec

> Protocol ระหว่าง PC ↔ ESP32 ผ่าน USB Serial baud 115200

---

## 1. Format

- **Newline-delimited JSON (NDJSON)** — แต่ละ message ขึ้นบรรทัดใหม่ด้วย `\n`
- ทุก message เป็น JSON object
- มี field `type` เสมอ → `"event"` (ESP32→PC) หรือ `"cmd"` (PC→ESP32) หรือ `"ack"` / `"hello"`
- ขนาด max 256 bytes ต่อบรรทัด (ESP32 buffer)

```
{"type":"event","name":"bill_pulse","amount":10}\n
{"type":"cmd","name":"dispense","coins":2}\n
```

---

## 2. ESP32 → PC (Events)

### 2.1 `hello` — แจ้งตอน boot
```json
{
  "type": "hello",
  "fw": "1.0.0",
  "boot_reason": "POWERON_RESET",
  "uptime": 0
}
```
ส่งครั้งเดียวเมื่อ ESP32 boot

### 2.2 `heartbeat` — แสดงว่ายังมีชีวิต
```json
{
  "type": "event",
  "name": "heartbeat",
  "uptime": 12345,
  "free_heap": 230400
}
```
ส่งทุก 1 วินาที

### 2.3 `bill_pulse` — รับ pulse จาก NK77
```json
{
  "type": "event",
  "name": "bill_pulse",
  "amount": 10
}
```
ส่งทุกครั้งที่ ISR ตรวจจับ pulse (1 pulse = 10 บาท)

### 2.4 `coin_dispensed` — เหรียญออกจาก hopper 1 อัน
```json
{
  "type": "event",
  "name": "coin_dispensed",
  "count": 1,
  "in_session": 3
}
```
- `count` = +1 (เพิ่มทีละหนึ่ง)
- `in_session` = จำนวนสะสมใน dispense session ปัจจุบัน

### 2.5 `dispense_done` — จ่ายเหรียญครบตามที่สั่ง
```json
{
  "type": "event",
  "name": "dispense_done",
  "total": 10,
  "duration_ms": 4200
}
```

### 2.6 `dispense_failed` — จ่ายไม่ครบ (jam / timeout)
```json
{
  "type": "event",
  "name": "dispense_failed",
  "reason": "timeout",
  "dispensed": 7,
  "expected": 10
}
```
`reason`: `"timeout"` | `"sensor_error"` | `"emergency_stop"`

### 2.7 `error` — error ทั่วไป
```json
{
  "type": "event",
  "name": "error",
  "code": "BILL_PULSE_TOO_FAST",
  "message": "Pulses < 30ms apart"
}
```

### 2.8 `ack` — ตอบรับ command
```json
{
  "type": "ack",
  "cmd": "dispense",
  "ok": true
}
```
```json
{
  "type": "ack",
  "cmd": "dispense",
  "ok": false,
  "error": "ALREADY_DISPENSING"
}
```

---

## 3. PC → ESP32 (Commands)

### 3.1 `dispense` — สั่งจ่ายเหรียญ
```json
{
  "type": "cmd",
  "name": "dispense",
  "coins": 10
}
```
- ESP32 จะตอบ `ack` ก่อน แล้วเริ่มหมุน hopper
- ระหว่างจ่าย: ส่ง `coin_dispensed` ทุกเหรียญ
- จบ: ส่ง `dispense_done` หรือ `dispense_failed`

### 3.2 `stop` — หยุด hopper ทันที (emergency)
```json
{
  "type": "cmd",
  "name": "stop"
}
```

### 3.3 `inhibit` — ปิดการรับแบงค์เฉพาะ
```json
{
  "type": "cmd",
  "name": "inhibit",
  "denoms": [20, 1000]
}
```
- `denoms` = list ของแบงค์ที่จะปิด (พวกที่ไม่อยู่ในนี้ = เปิด)
- ส่ง `denoms: []` = เปิดทุกแบงค์

### 3.4 `enable_all` / `disable_all`
```json
{"type":"cmd","name":"enable_all"}
{"type":"cmd","name":"disable_all"}
```
- `disable_all` = ปิดรับทุกแบงค์ (ใช้ตอน admin เติมเหรียญ, ตอน error)

### 3.5 `ping` — health check
```json
{"type":"cmd","name":"ping"}
```
ESP32 ตอบ:
```json
{"type":"event","name":"pong"}
```

### 3.6 `reboot` — restart ESP32
```json
{"type":"cmd","name":"reboot"}
```
ESP32 ตอบ ack แล้ว ESP.restart()

---

## 4. State ของแต่ละฝั่ง

### 4.1 ESP32 hopper state
```
IDLE → DISPENSING → DONE → IDLE
                 ↘ JAMMED → (need 'stop' or 'reboot')
```

### 4.2 PC machine state
```
IDLE → RECEIVING → DISPENSING → IDLE
              (timer 2s)    (รอ dispense_done)
              ↘ aborted → IDLE
```

---

## 5. Error codes

| Code | ความหมาย | Action |
|---|---|---|
| `ALREADY_DISPENSING` | ส่ง dispense ซ้ำขณะที่ยังจ่ายไม่จบ | PC ต้องรอ |
| `INVALID_COIN_COUNT` | coins ≤ 0 หรือ > 200 | PC ต้องตรวจก่อนส่ง |
| `BILL_PULSE_TOO_FAST` | pulse จาก NK77 ห่างกัน < 30ms | สงสัย noise |
| `HOPPER_TIMEOUT` | สั่ง hopper แต่ไม่มี coin ออกใน 3s | jam |
| `SENSOR_NOISE` | LG-JT02 มี pulse ผิดปกติตอนไม่ได้สั่ง | ตรวจ wiring |
| `WATCHDOG_TRIGGERED` | PC ขาด heartbeat 5s | ESP32 inhibit ทุกอย่าง |

---

## 6. Watchdog (สำคัญมาก ⚠️)

### 6.1 PC → ESP32
- PC ส่ง `ping` ทุก 2 วินาที (หรือ command ใดๆ ก็นับเป็น activity)
- ถ้า ESP32 ไม่ได้รับ message จาก PC เกิน 5 วินาที:
  1. ส่ง `disable_all` ภายในตัวเอง (inhibit ทุกแบงค์)
  2. ถ้ากำลัง dispense → continue จนจบ (ไม่ตัดกลางคัน)
  3. หลังจบ dispense → state เป็น IDLE
  4. เมื่อ PC กลับมา → ESP32 ส่ง `hello` ใหม่ → PC ส่ง enable_all กลับ

### 6.2 ESP32 → PC
- ESP32 ส่ง heartbeat ทุก 1 วินาที
- ถ้า PC ไม่ได้รับ heartbeat เกิน 3 วินาที:
  1. แสดงหน้า "ระบบขัดข้อง" บน UI
  2. ส่ง Discord alert
  3. รอ `hello` จาก ESP32 ใหม่
  4. เมื่อกลับมา → resume

---

## 7. Reliability concerns

### 7.1 Message ขาดหายระหว่างทาง
USB Serial มี error rate ต่ำมากแต่ไม่ใช่ศูนย์ — ป้องกัน:
- ทุก message ต้องเป็น JSON valid → parse ไม่ผ่าน = ทิ้ง + log
- `dispense_done` มี `total` → PC ตรวจเทียบกับ coin events ที่นับได้
- ถ้าไม่ตรง → ถือว่า error, log ละเอียด

### 7.2 USB ถอด/เสียบใหม่
- PC ต้องดี detect `close` event แล้ว reconnect ทุก 3 วินาที
- เมื่อ reconnect → ส่ง `ping` ก่อน เพื่อ sync state
- ระหว่างขาด → แสดง error screen, ไม่รับเงิน

### 7.3 ลำดับ message
- USB Serial = stream → ลำดับคงเดิม (FIFO)
- ไม่มี out-of-order
- แต่ partial message ได้! → PC ต้อง buffer จน `\n` แล้วค่อย parse

---

## 8. ตัวอย่าง code (snippet)

### 8.1 ESP32: ส่ง JSON
```cpp
#include <ArduinoJson.h>

void sendEvent(const char* name, int value) {
  StaticJsonDocument<128> doc;
  doc["type"] = "event";
  doc["name"] = name;
  doc["value"] = value;
  serializeJson(doc, Serial);
  Serial.println();  // ใส่ \n
}
```

### 8.2 ESP32: รับ JSON
```cpp
void readCommands() {
  static char buf[256];
  static int idx = 0;
  
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      buf[idx] = 0;
      handleLine(buf);
      idx = 0;
    } else if (idx < 255) {
      buf[idx++] = c;
    }
  }
}
```

### 8.3 Node.js: รับ JSON
```javascript
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line) => {
  try {
    const msg = JSON.parse(line);
    handleMessage(msg);
  } catch (err) {
    console.warn('Bad JSON from ESP32:', line);
  }
});
```

### 8.4 Node.js: ส่ง JSON
```javascript
function sendCmd(name, payload = {}) {
  const msg = { type: 'cmd', name, ...payload };
  port.write(JSON.stringify(msg) + '\n');
}

sendCmd('dispense', { coins: 10 });
sendCmd('inhibit', { denoms: [1000] });
```

---

## 9. Future-proofing สำหรับ QR Payment

เมื่อเพิ่ม QR ในอนาคต — **ESP32 ไม่ต้องแก้เลย** เพราะ:
- การจ่ายเหรียญใช้ `dispense` cmd เหมือนเดิม
- การคำนวณยอดเงินทำที่ PC (จาก QR webhook แทน `bill_pulse`)
- ESP32 ไม่ care ว่าเงินมาจากแบงค์หรือ QR

โครงสร้างฝั่ง PC จะมี:
```javascript
class PaymentSource {
  onPayment(callback) { /* ... */ }
}

class BillAcceptor extends PaymentSource {
  // listen bill_pulse events from ESP32
}

class QRPayment extends PaymentSource {
  // listen webhook from bank
}

// machine.js ใช้ interface เดียวกัน → swap หรือ add ได้เลย
```
