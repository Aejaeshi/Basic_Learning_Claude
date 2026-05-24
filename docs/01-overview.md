# 01 — ภาพรวมระบบ (System Overview)

> **เป้าหมาย:** ตู้แลกเหรียญอัตโนมัติสำหรับร้านเกม

---

## 1. Use Case — ลูกค้าใช้งานยังไง

```
1. ลูกค้ายืนหน้าตู้ → จอแสดง "กรุณาใส่ธนบัตร"
2. ลูกค้าใส่แบงค์ 100 บาท → NK77 อ่าน → ส่ง 10 pulses ไป ESP32
3. ESP32 ส่ง event ขึ้น PC ทีละ pulse → PC อัปเดตจอแบบ real-time:
   "จำนวนเงิน: 100 บาท | เหรียญที่จะได้: 10 เหรียญ"
4. NK77 ส่ง pulse ครบ → PC รอ 2 วินาทีเผื่อใส่แบงค์เพิ่ม
5. PC สั่ง ESP32: dispense 10 coins
6. Hopper หมุน → LG-JT02 นับเหรียญที่ออก
7. ครบ 10 เหรียญ → หยุด hopper → จอแสดง "ขอบคุณค่ะ"
8. กลับสู่หน้าจอ idle
```

---

## 2. Business Rules

### 2.1 อัตราแลก
| ใส่ | ได้ | จำนวน pulse จาก NK77 |
|---|---|---|
| 20 บาท | 2 เหรียญ × 10฿ | 2 pulses |
| 50 บาท | 5 เหรียญ × 10฿ | 5 pulses |
| 100 บาท | 10 เหรียญ × 10฿ | 10 pulses |
| 500 บาท | 50 เหรียญ × 10฿ | 50 pulses |
| 1000 บาท | 100 เหรียญ × 10฿ | 100 pulses |

**สูตรเดียวจบ: `เหรียญ = pulse_count`** (เพราะ 1 pulse = 10 บาท = 1 เหรียญ 10 บาท)

### 2.2 การใส่หลายใบ
- ลูกค้าใส่แบงค์ติดกันหลายใบได้
- PC รอ **2 วินาที** หลัง pulse สุดท้าย ก่อนเริ่ม dispense
- ตัวอย่าง: ใส่ 100 + 50 ติดกัน → ได้ 15 เหรียญในครั้งเดียว

### 2.3 Enable / Disable แบงค์
- Admin ตั้งได้ว่าจะรับแบงค์ไหนบ้าง
- PC ส่ง command `inhibit` ไป ESP32 → ESP32 ดึงสาย INHIBIT ของ NK77

### 2.4 เหรียญใกล้หมด
- Admin กำหนด threshold ได้ (default: 100 เหรียญ)
- เมื่อ count ≤ threshold → ส่งแจ้งเตือนเข้า Discord
- เมื่อ count < จำนวนที่ต้องจ่าย → **ปฏิเสธการรับเงิน** (inhibit ทุกแบงค์)

### 2.5 เหรียญหมดกลางคัน
- ถ้าจ่ายไปได้ X จากที่ต้องจ่าย Y แล้วเหรียญหมด:
  - **หยุด hopper** ทันที
  - **บันทึก log** ว่าค้าง (Y - X) เหรียญ
  - **แจ้ง Discord** พร้อมยอดค้าง
  - **แสดงข้อความบนจอ** "ระบบขัดข้อง กรุณาแจ้งพนักงาน — ค้าง N เหรียญ"
  - **ปิด NK77** ไม่รับเงินเพิ่ม

---

## 3. โหมดการทำงาน

### 3.1 โหมดปกติ (Customer Mode)
- จอแสดงหน้า idle รอลูกค้า
- รับแบงค์ → แสดง progress → จ่ายเหรียญ → กลับ idle

### 3.2 โหมด Admin (เข้าผ่าน Web)
URL: `http://localhost/admin` (ต้อง login)

ฟีเจอร์:
- ✅ ตั้งจำนวนเหรียญที่เติมเข้าตู้ (set / add / subtract)
- ✅ Enable/Disable แบงค์แต่ละชนิด
- ✅ ตั้ง low coin threshold
- ✅ ดู transaction log (วันนี้ / 7 วัน / ทั้งหมด)
- ✅ Daily summary (ยอดรับ, ยอดจ่าย, มีปัญหากี่ครั้ง)
- ✅ Test dispense (ทดสอบสั่งเหรียญทีละเหรียญ)
- ✅ Manual inhibit ทั้งตู้ (ปิดรับเงินชั่วคราว เช่น ตอนเติมเหรียญ)
- ✅ ตั้ง Discord webhook URL
- ✅ Restart ESP32

---

## 4. หน้าจอลูกค้า — 3 สถานะหลัก

### 4.1 Idle (ว่าง)
```
        💵  ใส่ธนบัตรเพื่อแลกเหรียญ
        
   รับแบงค์: [20] [50] [100] [500] [1000]
                
        [animation เหรียญหมุน]
        
        เหรียญในตู้: 2,450 เหรียญ
```

### 4.2 Receiving (กำลังรับเงิน)
```
        ✅  ได้รับเงิน
        
        100 บาท
        เหรียญที่จะได้: 10 เหรียญ
        
        [⏳ กำลังนับ... ใส่เพิ่มได้]
```

### 4.3 Dispensing (กำลังจ่ายเหรียญ)
```
        💰  กำลังจ่ายเหรียญ
        
        ▓▓▓▓▓▓░░░░  6 / 10 เหรียญ
        
        [animation เหรียญหล่น]
```

### 4.4 Error
```
        ⚠️  ระบบขัดข้อง
        
        กรุณาแจ้งพนักงาน
        Error: COIN_JAM
```

---

## 5. Discord Notifications

| Event | ตัวอย่างข้อความ |
|---|---|
| `low_coin` | 🟡 เหรียญเหลือน้อย: 95 เหรียญ (threshold 100) |
| `out_of_coin` | 🔴 เหรียญหมด! หยุดรับเงินอัตโนมัติแล้ว |
| `coin_jam` | 🔴 Hopper jam ระหว่างจ่ายเหรียญ — ค้าง 3 เหรียญ |
| `bill_jam` | 🔴 NK77 ส่งสัญญาณผิดปกติ |
| `pc_esp32_disconnect` | 🔴 PC ↔ ESP32 ขาดการสื่อสาร > 5 วินาที |
| `coin_refill` | 🟢 เติมเหรียญแล้ว — ตอนนี้ 2,450 เหรียญ |
| `daily_summary` | 📊 สรุปวันที่ 2026-05-24<br/>รับเงิน: 4,200 บาท / 32 transactions<br/>จ่ายเหรียญ: 420 เหรียญ<br/>ค้าง: 0 |

---

## 6. ข้อมูลที่เก็บ (SQLite Schema สั้นๆ)

```sql
-- ทุก transaction
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  bills_total INTEGER,      -- บาท
  coins_dispensed INTEGER,  -- จำนวนเหรียญที่จ่ายจริง
  coins_owed INTEGER,       -- ค้าง (ปกติ = 0)
  status TEXT,              -- 'completed' | 'jammed' | 'aborted'
  error TEXT
);

-- การเติมเหรียญเข้าตู้
CREATE TABLE coin_refills (
  id INTEGER PRIMARY KEY,
  added_at TIMESTAMP,
  amount INTEGER,
  by_admin TEXT
);

-- system events (ไว้ debug)
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  timestamp TIMESTAMP,
  level TEXT,  -- 'info' | 'warn' | 'error'
  source TEXT, -- 'esp32' | 'pc' | 'admin'
  message TEXT,
  data TEXT    -- JSON
);

-- settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- เช่น: coin_count, low_threshold, inhibit_20, discord_webhook, admin_password_hash
```

---

## 7. ไฟล์ที่เกี่ยวข้อง
- [02-hardware.md](02-hardware.md) — รายการอุปกรณ์, การต่อสาย
- [03-architecture.md](03-architecture.md) — Software architecture
- [05-workflow.md](05-workflow.md) — State machine ละเอียด
- [06-safety.md](06-safety.md) — กฎความปลอดภัย + error handling
