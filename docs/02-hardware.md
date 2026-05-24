# 02 — Hardware Spec, BOM, Wiring

> ทุกอุปกรณ์ + การต่อสาย + เหตุผลที่ต้องมี optocoupler / MOSFET

---

## 1. Bill of Materials (BOM)

### 1.1 Main components

| # | อุปกรณ์ | จำนวน | ราคา (฿) | หมายเหตุ |
|---|---|---:|---:|---|
| 1 | NK77 Bill Acceptor | 1 | 1,800–2,500 | รับ 20/50/100/500/1000 |
| 2 | Hopper 24V (Coin Hopper) | 1 | 1,500–2,500 | ใส่เหรียญ 10 บาท |
| 3 | LG-JT02 Photoelectric Sensor | 1 | 150–300 | ตรวจเหรียญที่ออก |
| 4 | ESP32 DevKit V1 (38-pin) — **WROOM-32E** | 1 | 200–280 | MCU (เลือก 32E: Espressif official, ECO V3 silicon — เสถียรกว่า 32S สำหรับใช้ 24/7) |
| 5 | PC เก่า + จอ 18" | 1 | (มีแล้ว) | Brain + Display |

### 1.2 Power supply

| # | อุปกรณ์ | จำนวน | ราคา (฿) | หมายเหตุ |
|---|---|---:|---:|---|
| 6 | PSU 24V 5A (Meanwell LRS-100-24) | 1 | 400–600 | ขับ Hopper |
| 7 | DC-DC Step-down 24V→12V 2A | 1 | 50–100 | ให้ NK77 |
| 8 | DC-DC Step-down 24V→5V 3A | 1 | 60–120 | ให้ ESP32 (ผ่าน USB หรือ Vin) |
| 9 | UPS เล็กๆ (สำหรับ PC) | 1 | 1,500–2,500 | ⚠️ แนะนำมาก กันไฟดับกลาง transaction |

### 1.3 Isolation & Driver circuit (สำคัญ ห้ามขาด)

| # | อุปกรณ์ | จำนวน | ราคา (฿) | หมายเหตุ |
|---|---|---:|---:|---|
| 10 | Optocoupler PC817 | 6–8 | 5 ต่อตัว | แยกสัญญาณ NK77/LG-JT02 ออกจาก ESP32 |
| 11 | MOSFET IRLZ44N (Logic-level) | 1 | 30–50 | ขับ Hopper |
| 12 | Flyback Diode 1N5408 (3A) | 1 | 5 | ป้องกัน inductive kickback |
| 13 | Resistor 220Ω, 1kΩ, 10kΩ | ชุด | 50 | สำหรับ optocoupler + pull-up/down |
| 14 | Relay Module 24V SSR (ทางเลือก) | 1 | 100–200 | ทางเลือกแทน MOSFET |

### 1.4 อื่นๆ

| # | อุปกรณ์ | จำนวน | ราคา (฿) | หมายเหตุ |
|---|---|---:|---:|---|
| 15 | Terminal block, สายไฟ, เทอร์มินอลกลม | ชุด | 200 | — |
| 16 | กล่องใส่วงจร + ฮีตซิงค์ MOSFET | 1 | 150 | — |
| 17 | สาย USB-A to Micro-USB (ESP32) | 1 | 50 | คุณภาพดี ไม่ใช่สาย charge อย่างเดียว |
| 18 | SSD 120GB (อัปเกรด PC) | 1 | 400 | แทน HDD เก่า — เพิ่ม reliability |

**รวมประมาณ: 7,000–12,000 บาท** (ไม่รวม PC ที่มีอยู่แล้ว)

---

## 2. Power Architecture

```
[AC 220V]
    │
    ├──► [PSU 24V/5A] ──► 24V Rail
    │                       │
    │                       ├──► Hopper Motor (ผ่าน MOSFET)
    │                       │
    │                       ├──► [DC-DC 24→12V] ──► NK77 (V+ pin)
    │                       │                          │
    │                       │                          └──► sensors V+ (12V)
    │                       │
    │                       └──► [DC-DC 24→5V]  ──► ESP32 (Vin) (optional)
    │
    └──► [UPS] ──► [PC + จอ 18"]
                        │
                        └── USB ──► ESP32 (5V จาก USB — ใช้อันนี้ก็พอ)
```

> **ทางเลือกง่ายๆ:** ใช้ USB จาก PC ป้อน ESP32 ก็ได้ — ไม่ต้อง DC-DC 24→5V
> **แต่:** ถ้า PC ปิด ESP32 จะดับ → NK77 ยังเปิดอยู่ → คนใส่เงินได้ แต่ไม่จ่ายเหรียญ
> **ทางที่ดีกว่า:** ESP32 มีไฟเลี้ยงแยก + USB ใช้แค่ data → ถ้า PC ดับ ESP32 ยัง inhibit NK77 ได้
> วิธีใช้ USB data only: ตัดสายไฟ VCC ของ USB หรือใช้ USB isolator

---

## 3. Voltage Map (สำคัญที่สุด)

| อุปกรณ์ | Vsupply | Logic Signal | หมายเหตุ |
|---|---|---|---|
| NK77 | 12V | output 12V pulse (open collector) | ⚠️ ห้ามต่อตรง ESP32 |
| Hopper Motor | 24V | — (ขับด้วย MOSFET) | กระแสสูง ต้อง flyback diode |
| LG-JT02 | 12–24V | output 12V/24V (NPN/PNP) | ⚠️ ห้ามต่อตรง ESP32 |
| ESP32 | 3.3V | input/output 3.3V tolerant | ❌ ไม่ทน 5V บางขา ❌ ไม่ทน 12V/24V แน่นอน |

> 💡 **กฎเหล็ก:** ทุกสัญญาณที่เข้าหรือออก ESP32 จากของ 12V/24V → **ผ่าน optocoupler เสมอ**

---

## 4. Pin Assignment (ESP32 DevKit V1)

| GPIO | หน้าที่ | ทิศทาง | หมายเหตุ |
|---|---|---|---|
| **GPIO 4** | NK77 Pulse Input | IN (interrupt) | ผ่าน PC817, pull-up 10kΩ |
| **GPIO 5** | LG-JT02 Coin Pulse | IN (interrupt) | ผ่าน PC817, pull-up 10kΩ |
| **GPIO 18** | Hopper Motor Control | OUT | → MOSFET gate (ผ่าน 220Ω) |
| **GPIO 19** | NK77 Inhibit (20฿) | OUT | ผ่าน PC817 → INH pin |
| **GPIO 21** | NK77 Inhibit (50฿) | OUT | ผ่าน PC817 → INH pin |
| **GPIO 22** | NK77 Inhibit (100฿) | OUT | ผ่าน PC817 → INH pin |
| **GPIO 23** | NK77 Inhibit (500฿) | OUT | ผ่าน PC817 → INH pin |
| **GPIO 25** | NK77 Inhibit (1000฿) | OUT | ผ่าน PC817 → INH pin |
| **GPIO 26** | NK77 Enable Master | OUT | ปิดทั้งหมดทีเดียวเมื่อ emergency |
| **GPIO 27** | Status LED | OUT | ไฟแสดงสถานะ ESP32 |
| **GPIO 32** | Buzzer (optional) | OUT | beep ตอนจ่ายเหรียญเสร็จ |
| **GPIO 33** | Reserved (future: button) | IN | — |
| **GPIO 34** | Reserved (input-only) | IN | — เผื่ออนาคต |

### หลีกเลี่ยง GPIO เหล่านี้:
- **GPIO 0, 2, 12, 15** — boot strap pins (ใช้ผิดอาจ boot ไม่ติด)
- **GPIO 6–11** — ใช้กับ flash (ห้ามแตะ)
- **GPIO 1, 3** — UART0 (ใช้ debug + flash code + Serial.print)
- **GPIO 9, 10** — UART1 (สำรอง)

---

## 5. Wiring Diagrams (Text Format)

### 5.1 NK77 Pulse → ESP32 (ผ่าน PC817)

```
NK77 COIN OUT ─┬─── R 1kΩ ───┐
               │              │
              12V           [PC817 LED]    ← วงจรฝั่ง 12V
                              │
NK77 GND   ────────────────── ┘

                              ┌──── 3.3V (ESP32)
                              │
                          R 10kΩ (pull-up)
                              │
ESP32 GPIO4 ◄─────────────────┼─── [PC817 transistor C]
                              │
                              └─── [PC817 transistor E] ── GND
```

**อธิบาย:** เมื่อ NK77 มี pulse (active LOW) → LED ใน PC817 สว่าง → transistor ON → GPIO4 ถูกดึงลง LOW → ESP32 detect ผ่าน interrupt FALLING

### 5.2 ESP32 → Hopper Motor (ผ่าน MOSFET)

```
                                          24V ──┐
                                                │
                                          [Hopper Motor M]
                                                │
GPIO18 ─── R 220Ω ─── [G] IRLZ44N             [Flyback Diode 1N5408]
                       [D]──────────────────────┤  (cathode ไปที่ 24V)
                       [S]────── GND            │
                                                │
                                          GND ──┘
```

**อธิบาย:**
- IRLZ44N เป็น **logic-level MOSFET** เปิดเต็มที่ที่ Vgs = 3.3V (ของ ESP32 พอ)
- Flyback diode คร่อม motor — เมื่อปิด MOSFET, สนามแม่เหล็กใน motor สลาย → เกิด spike แรงดันสูง → diode ระบายลง 24V rail ป้องกัน MOSFET พัง
- R 220Ω ที่ gate → จำกัดกระแส inrush ตอน gate charge

⚠️ **WARNING:** ห้ามลืม flyback diode เด็ดขาด — MOSFET พังภายใน 1-2 ครั้งหมุน

### 5.3 LG-JT02 → ESP32

**กรณี NPN sensor (สายดำ = signal, sink to GND):**
```
LG-JT02 V+ (น้ำตาล) ──── 12V
LG-JT02 GND (น้ำเงิน) ── GND

LG-JT02 OUT (ดำ) ─── R 1kΩ ─── [PC817 LED anode]
                                [PC817 LED cathode] ── GND

ESP32 GPIO5 ◄── R 10kΩ pull-up ── 3.3V
              [PC817 transistor C]
              [PC817 transistor E] ── GND
```

**กรณี PNP sensor (สายดำ = signal, source from V+):**
- ต่อกลับขั้ว LED ของ PC817
- หรือใช้ voltage divider 12V → 3.3V (แต่ optocoupler ปลอดภัยกว่า)

### 5.4 NK77 INHIBIT (ESP32 ปิดแบงค์เฉพาะ)

NK77 มีสาย INHIBIT แยกตามแบงค์ (INH1, INH2, INH3, INH4, INH5)
ปกติเป็น active LOW (pull LOW = ปิดรับแบงค์นั้น)

```
ESP32 GPIO19 ─── [PC817 LED] ─── R 220Ω ─── 3.3V
                                              
                 [PC817 transistor C] ─── NK77 INH1 (20฿)
                 [PC817 transistor E] ─── NK77 GND
```

GPIO HIGH → LED OFF → transistor OFF → INH ลอย (default HIGH = รับแบงค์)
GPIO LOW → LED ON → transistor ON → ดึง INH ลง GND = ปิดรับ

> 💡 **เคล็ดลับ:** เริ่มต้น ESP32 ให้ทุก GPIO INHIBIT = HIGH (รับทุกแบงค์) แล้วค่อยให้ PC สั่งเปลี่ยน

---

## 6. คำเตือนสำคัญ ⚠️

1. **ห้ามต่อ ESP32 ตรงกับ 12V/24V** — พังทันที, ไม่มียกเว้น
2. **ห้ามลืม flyback diode คร่อม motor** — MOSFET จะพังเร็วมาก
3. **เลือก MOSFET ที่ "Logic-level"** (Vgs(th) < 3V) เช่น IRLZ44N — อย่าใช้ IRF540 (ต้อง 10V)
4. **ก่อนเสียบ USB ของ ESP32 เข้า PC** → ตรวจ GND ของ ESP32 กับ PC ให้ common ground
5. **สาย USB ระหว่าง PC ↔ ESP32 ต้องเป็นแบบ data** ไม่ใช่ charge-only
6. **กระแส hopper peak อาจ 3A** — PSU 24V ขั้นต่ำ 5A เผื่อ surge
7. **ระวัง ground loop** — PSU 24V ของ hopper กับ USB ของ ESP32 ต้องมี GND ร่วม แต่อย่าให้กระแสสูงจาก hopper วิ่งผ่าน USB → ใช้ wire หนาแยก high-current return path
8. **ติดฮีตซิงค์ที่ MOSFET** — ถึงจะ ON สั้นๆ แต่ปลอดภัยกว่า

---

## 7. Test ก่อนต่อทุกอย่างเข้าด้วยกัน

ทำตามลำดับ ห้ามข้าม:

1. **ทดสอบ PSU ก่อน** — เปิด PSU ลอย วัดแรงดัน 24V, 12V, 5V ให้ตรง
2. **ทดสอบ ESP32 ลอย** — flash blink, ดู Serial Monitor
3. **ทดสอบ optocoupler ทีละตัว** — ใช้ 5V กระตุ้น LED แล้ววัด transistor ฝั่ง 3.3V
4. **ทดสอบ MOSFET ลอย** — ใช้หลอด LED + R 1kΩ แทน motor ก่อน
5. **ทดสอบ NK77 ลอย** — จ่ายไฟ 12V อย่างเดียว ใส่แบงค์ ดู LED + เสียง
6. **ทดสอบ Hopper ลอย** — จ่ายไฟ 24V ตรง (ไม่ผ่าน MOSFET) ดูว่าหมุน + จ่ายเหรียญ
7. **ทดสอบ LG-JT02 ลอย** — จ่ายไฟ ใช้ multimeter อ่าน output ตอนเอามือบัง
8. **เชื่อมต่อทีละชิ้น** กับ ESP32, ทดสอบทีละ feature
9. **ทดสอบรวม** สุดท้ายก่อนใส่ในกล่อง

---

## 8. ⚠️ จุดเสี่ยงที่ต้องระวังเป็นพิเศษ

| ความเสี่ยง | ผลกระทบ | วิธีแก้ |
|---|---|---|
| ESP32 บูทตอน Hopper กำลังหมุน | MOSFET gate ลอย → motor กระตุก | Pull-down 10kΩ ที่ gate ตลอด |
| Brown-out ESP32 ตอน Hopper เริ่มหมุน (กระแสกระชาก) | ESP32 reset | แยก PSU + cap 1000µF ที่ ESP32 |
| EMI จาก motor รบกวน signal | นับ pulse ผิด | เดินสาย signal แยกจาก power, ใช้ shielded |
| LG-JT02 อ่านพลาด (เหรียญสองอันพร้อมกัน) | นับขาด | ตรวจสอบ rate, ถ้าเหรียญมาเร็วเกิน beep alert |
| สาย USB หลุดตอนใช้งาน | ESP32 ดับ ← ดู section 2 | ใช้ไฟเลี้ยงแยก + USB data only |
