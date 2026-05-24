# 05 — Workflow & State Machine

> State machine ละเอียดของ PC + ESP32 + sequence diagrams

---

## 1. PC Business State Machine

### 1.1 States
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   ┌──────┐   bill_pulse    ┌───────────┐               │
│   │      │ ───────────────►│           │               │
│   │ IDLE │                 │ RECEIVING │               │
│   │      │ ◄───────────────│           │               │
│   └──┬───┘  bill_timeout   └─────┬─────┘               │
│      ▲      (no coins owed)      │ 2s no pulse         │
│      │                           │ + coins_to_pay > 0  │
│      │                           ▼                     │
│      │                    ┌──────────────┐             │
│      │  dispense_done     │  DISPENSING  │             │
│      ├────────────────────│              │             │
│      │                    └──────┬───────┘             │
│      │                           │ failed              │
│      │                           ▼                     │
│      │                    ┌──────────────┐             │
│      │  admin clear       │    ERROR     │             │
│      └────────────────────│              │             │
│                           └──────────────┘             │
│                                                         │
│   Side states (overlay):                                │
│   • DISABLED   ← admin หรือ out of coin                  │
│   • OFFLINE    ← ESP32 ขาดการสื่อสาร                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 State details

#### `IDLE`
- หน้าจอแสดง "ใส่ธนบัตรเพื่อแลกเหรียญ"
- รอ event `bill_pulse`
- ตรวจสอบ coin_count > min ก่อนรับเงิน (ถ้าไม่พอ → DISABLED)

**Transitions:**
- `bill_pulse` → `RECEIVING`
- admin disable → `DISABLED`
- ESP32 disconnect → `OFFLINE`

#### `RECEIVING`
- แสดงยอดสะสมแบบ real-time
- Timer 2 วินาที reset ทุก pulse ใหม่
- ถ้า coin_count - committed < coins_to_pay → cancel + แสดง error

**Transitions:**
- `bill_pulse` → stay `RECEIVING`, reset timer
- timer 2s expire → `DISPENSING` (ถ้า coins_to_pay > 0)
- ESP32 disconnect → `ERROR`

#### `DISPENSING`
- ส่ง cmd `dispense` ไป ESP32
- รอ events `coin_dispensed` × N
- แสดง progress bar
- Timeout: 30 วินาที (10 เหรียญ × 3s/เหรียญ buffer)

**Transitions:**
- `dispense_done` (count ตรง) → `IDLE` (หลัง 5s แสดง "ขอบคุณ")
- `dispense_failed` → `ERROR`
- timeout → `ERROR`

#### `ERROR`
- แสดง "ระบบขัดข้อง กรุณาแจ้งพนักงาน"
- ส่ง Discord alert
- รอ admin reset (จาก web หรือ key switch)

**Transitions:**
- admin clear → `IDLE`

#### `DISABLED` (overlay state)
- ใช้เมื่อ: out of coin / admin ปิด / กำลังเติมเหรียญ
- หน้าจอ "ปิดให้บริการชั่วคราว"
- ESP32 อยู่ในโหมด `disable_all`

#### `OFFLINE` (overlay state)
- ใช้เมื่อ: USB ขาด หรือ ESP32 ไม่ตอบ heartbeat
- หน้าจอ "ระบบขัดข้อง"
- Backend พยายาม reconnect ทุก 3s

---

## 2. Sequence: Happy Path (100฿ → 10 เหรียญ)

```
ลูกค้า    NK77         ESP32              PC Backend         Browser
  │        │              │                     │                │
  │   ใส่ 100฿            │                     │                │
  ├───────►│              │                     │                │
  │        │  10 pulses   │                     │                │
  │        ├─────────────►│                     │                │
  │        │              │ bill_pulse × 10     │                │
  │        │              ├────────────────────►│                │
  │        │              │                     │ WS push × 10   │
  │        │              │                     ├───────────────►│
  │        │              │                  (state: RECEIVING)  │
  │        │              │                     │ "100฿ / 10 ehrs"│
  │        │              │                     │                │
  │        │              │ (รอ 2s no pulse)    │                │
  │        │              │                     │                │
  │        │              │ cmd dispense 10     │                │
  │        │              │◄────────────────────┤                │
  │        │              │ ack                 │                │
  │        │              ├────────────────────►│                │
  │   (hopper หมุน)       │                     │ WS "dispensing"│
  │        │              │                     ├───────────────►│
  │        │              │                     │                │
  │  เหรียญที่ 1 ออก       │                     │                │
  │◄───────┼─[LG-JT02]────│                     │                │
  │        │              │ coin_dispensed 1    │                │
  │        │              ├────────────────────►│ WS "1/10"      │
  │        │              │                     ├───────────────►│
  │     ...(× 10)         │                     │                │
  │        │              │ dispense_done 10    │                │
  │        │              ├────────────────────►│                │
  │        │              │                     │ log DB         │
  │        │              │                     │ coin_count-=10 │
  │        │              │                     │ WS "completed" │
  │        │              │                     ├───────────────►│
  │        │              │                     │                │
  │  (แสดง "ขอบคุณ" 5s)                          │                │
  │        │              │                     │ WS "idle"      │
  │        │              │                     ├───────────────►│
```

---

## 3. Sequence: Coin Jam (jam ระหว่างจ่ายเหรียญ 6 ใน 10)

```
... (เหมือนเดิมจนถึง dispense)
  │        │              │ cmd dispense 10     │                │
  │        │              │◄────────────────────┤                │
  │  เหรียญ 1-6 ออก        │ coin_dispensed × 6  │                │
  │        │              ├────────────────────►│ WS progress    │
  │        │              │                     │                │
  │  (เหรียญติด, ไม่ออก)  │                     │                │
  │        │              │ (รอ 3s no coin)     │                │
  │        │              │ HOPPER_TIMEOUT      │                │
  │        │              │ → ปิด MOSFET        │                │
  │        │              │ dispense_failed     │                │
  │        │              │  reason=timeout     │                │
  │        │              │  dispensed=6        │                │
  │        │              │  expected=10        │                │
  │        │              ├────────────────────►│                │
  │        │              │                     │ log: jammed    │
  │        │              │                     │ coins_owed=4   │
  │        │              │                     │ Discord alert  │
  │        │              │                     │ state=ERROR    │
  │        │              │                     │ WS error msg   │
  │        │              │                     ├───────────────►│
  │        │              │                     │ "ระบบขัดข้อง   │
  │        │              │                     │  ค้าง 4 เหรียญ"│
```

**Recovery:**
- พนักงานเปิดตู้ → แก้ jam → กดปุ่ม "test dispense" จาก admin web จ่ายเหรียญที่ค้างให้ลูกค้า
- จากนั้น admin กด "Clear Error" → state กลับ IDLE

---

## 4. Sequence: ใส่หลายแบงค์ติดกัน

```
ลูกค้าใส่ 100฿ → 10 pulses
   ⏱ ผ่านไป 1 วินาที (ยังไม่ถึง 2s timeout)
ลูกค้าใส่ 50฿ → 5 pulses (รวม 15)
   ⏱ ผ่านไป 1 วินาที (timer reset เป็นใหม่)
ลูกค้าใส่ 20฿ → 2 pulses (รวม 17)
   ⏱ ผ่านไป 2 วินาทีไม่มี pulse
→ DISPENSING 17 เหรียญในรอบเดียว
```

> 💡 **ทำไม timer 2s:** กันลูกค้ายังหยิบเงินใส่ไม่ทัน บอกชัดในจอว่า "ใส่เพิ่มได้"

---

## 5. Sequence: Low coin → out of coin

```
state: IDLE, coin_count = 105, threshold = 100

ลูกค้าใส่ 100฿ → DISPENSING 10 เหรียญ
dispense_done → coin_count = 95
95 ≤ 100 → ส่ง Discord "Low coin: 95"

state: IDLE, coin_count = 95

ลูกค้าใส่ 1000฿ → 100 pulses
→ RECEIVING: รับครบ 1000฿
→ check: ต้องจ่าย 100 เหรียญ แต่มี 95 → REJECT
→ state: ERROR "เหรียญไม่พอ — ติดต่อพนักงาน"
→ Discord "REJECT: needed 100 but have 95"

(จริงๆ ควรปฏิเสธก่อนรับแบงค์ — ดู section 6)
```

⚠️ **ปัญหา:** ถ้า NK77 รับแบงค์ไปแล้วก่อนเรารู้ว่าเหรียญไม่พอ — เงินอยู่ใน NK77 แล้ว ลูกค้าจะเรียกร้องเหรียญ → ต้องแก้แบบนี้:

### 6. Pre-validation (สำคัญ)
PC ต้อง proactive **inhibit แบงค์ที่จ่ายไม่ได้** ทุกครั้งที่ coin_count เปลี่ยน:

```
coin_count = 95
→ inhibit 1000฿ (ต้องการ 100 เหรียญ — ไม่พอ)
→ inhibit 500฿ (ต้องการ 50 เหรียญ — พอ ✓)
→ allow 20, 50, 100

ลูกค้าใส่ 1000฿ → NK77 ปฏิเสธ คายแบงค์ออก
```

โค้ดตัวอย่าง (Node.js):
```javascript
function updateInhibitsByCoinCount() {
  const denoms = [20, 50, 100, 500, 1000];
  const tooBig = denoms.filter(d => d > coinCount * 10);
  // + รวมแบงค์ที่ admin disable
  const inhibited = [...new Set([...tooBig, ...adminDisabled])];
  esp32.send('inhibit', { denoms: inhibited });
}
```

---

## 7. Edge Cases ที่ต้องจัดการ

| Case | สาเหตุ | วิธีจัดการ |
|---|---|---|
| ใส่แบงค์แล้วเครื่องดับกลางคัน | ไฟดับ | UPS + log ก่อน dispense + recovery on boot |
| LG-JT02 อ่านเหรียญสองเหรียญพร้อมกัน | hopper ผลัก 2 อันชน sensor | ตั้ง min pulse interval = 50ms (กว่านั้นถือว่า 1) |
| LG-JT02 false positive (noise) | EMI จาก motor | สาย shielded + de-bounce 5ms ใน ISR |
| NK77 ส่ง pulse ขณะ DISPENSING | ลูกค้าใส่แบงค์ใหม่ตอนกำลังจ่าย | queue ไว้, จ่ายต่อหลังรอบนี้จบ |
| Hopper หมุนนานเกินไป (sensor ตาย) | sensor ไม่ทำงาน | timeout 3s + ESP32 emergency stop |
| Bill pulse ที่ไม่ใช่ทวีคูณของ valid bill | NK77 พลาด | ถือว่า valid (เชื่อ NK77) แต่ log |
| PC restart ระหว่าง DISPENSING | crash, update | recovery: อ่านจาก DB transaction status, ถ้า in_progress → ERROR |
| Admin ลบ coin_count กลางคัน | ผิดพลาด | requires confirmation dialog + log who/when |
| ระยะเหรียญติด - hopper หมุน แต่ไม่มีเหรียญออก | hopper jam | timeout + alert ↑ |
| สาย USB หลวมๆ จนข้อมูลผิด | hardware | parse fail = ignore, log + alert ถ้าเกิดบ่อย |

---

## 8. Recovery หลัง PC Reboot

```
PC boot
  ↓
อ่าน last transaction จาก DB
  ↓
มี transaction status='in_progress'?
  YES → mark as 'recovered_unknown', alert Discord
        แสดงข้อความให้ admin check
  NO  → state = IDLE
  ↓
connect ESP32
  ↓
ส่ง ping → รอ pong
  ↓
ส่ง inhibit ตาม coin_count + admin settings
  ↓
state ready
```

---

## 9. Admin Workflow

### 9.1 เติมเหรียญ
```
admin → กด "Add Coins"
  → ใส่จำนวน (เช่น +500)
  → confirm
  → DB: insert into coin_refills, update settings.coin_count
  → ส่ง Discord "เติมเหรียญ 500 → ตอนนี้ 595"
  → recalc inhibits (อาจเปิดแบงค์ที่เคย disable)
```

### 9.2 ปิดตู้ชั่วคราว (เติมเหรียญ, ซ่อม)
```
admin → toggle "Disable Machine"
  → ESP32: disable_all
  → state: DISABLED
  → จอลูกค้า "ปิดให้บริการชั่วคราว"
```

### 9.3 Test dispense
```
admin → "Test Dispense" → ใส่จำนวน 1-10 เหรียญ
  → ESP32: cmd dispense N
  → ผลลัพธ์แสดงในหน้า admin
  → log to events table (level=info, source=admin)
```
