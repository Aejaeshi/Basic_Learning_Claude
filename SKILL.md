# Working Agreement — วิธีที่ Claude ควรช่วยในโปรเจกต์นี้

ไฟล์นี้คือ "สัญญาทำงาน" ระหว่างเจ้าของโปรเจกต์กับ Claude
อ่านก่อนตอบทุกครั้งใน session ใหม่

---

## 👤 บริบทผู้ใช้

- เจ้าของโปรเจกต์กำลัง **เรียนรู้ไปพร้อมกับการสร้าง**
- ไม่ใช่ professional embedded engineer แต่เข้าใจพื้นฐาน
- เขียนโค้ดมาบ้าง แต่ไม่ลึก
- ต้องการให้ **อธิบายเหตุผล** ไม่ใช่แค่โยนโค้ดให้
- ทำงานบน Windows ใช้ PowerShell

---

## 🗣️ ภาษา

- **ตอบเป็นไทยเป็นหลัก**
- Code, keyword, ชื่อ library, protocol → ภาษาอังกฤษ
- คำอธิบายเทคนิค → ไทย พร้อมเทียบเคียง keyword อังกฤษในวงเล็บ

ตัวอย่าง: "ใช้ non-blocking pattern (millis() แทน delay()) เพื่อไม่ให้ loop หยุดรอ"

---

## ✅ ที่ต้องทำ (DO)

### 1. แจ้งเตือนความเสี่ยงเชิงรุก (PROACTIVE WARNING)
ทุกครั้งที่เห็นความเสี่ยงต่อไปนี้ **ต้องเตือนทันที** ห้ามเงียบ:
- ⚡ **ไฟฟ้า** — แรงดันไม่ match, ไม่มี optocoupler/MOSFET, ลืม flyback diode
- 🔒 **Security** — password hardcode, ไม่มี auth บน admin page, expose serial port
- 💾 **Data loss** — ไม่ save state ก่อน power loss, transaction ไม่ atomic
- 🐛 **Race condition** — interrupt ที่ไม่ใช้ `volatile`, shared state ไม่มี mutex
- 💸 **เงิน/เหรียญหาย** — flow ที่ทำให้ count ไม่ตรง, edge case ที่ลูกค้าได้เหรียญฟรี/ไม่ได้เหรียญ

รูปแบบ: ⚠️ **WARNING:** [ความเสี่ยง] → [ผลกระทบ] → [วิธีแก้]

### 2. สอนไปด้วย
- อธิบาย **"ทำไม"** ก่อน **"ทำอย่างไร"**
- พอเขียน code segment ที่ไม่ obvious → อธิบายว่า trick นี้ทำอะไร
- เปรียบเทียบทางเลือกที่ไม่ได้เลือก (เช่น "ทำไมใช้ interrupt แทน polling")

### 3. ออกแบบโค้ดให้แก้/เพิ่มง่าย
- แยก module ตามหน้าที่ (single responsibility)
- ใช้ interface/class แยกชิ้นส่วน (เผื่อเปลี่ยน hardware ทีหลัง)
- เผื่อช่องสำหรับ **QR Payment** ในอนาคต (ห้าม hardcode "bill only")

### 4. ใช้ TaskCreate เมื่อทำงานหลายขั้นตอน
- เห็นโครงงาน 3+ ขั้นตอน → สร้าง task list ทันที
- update status ตามจริง (in_progress / completed)

### 5. Confirm ก่อนทำสิ่งที่กลับคืนยาก
- ก่อนลบไฟล์, ก่อน flash firmware, ก่อนแก้ schema DB → ถามก่อน
- การสร้างไฟล์ใหม่ / แก้โค้ด → ทำได้เลย

---

## ❌ ที่ห้ามทำ (DON'T)

1. ❌ **อย่าเสนอ delay() ใน loop ของ ESP32** — ทำให้ระบบไม่ตอบสนอง pulse ที่เข้ามาเร็ว
2. ❌ **อย่าให้ ESP32 อ่าน/ขับสัญญาณ 12V/24V โดยตรง** — ต้องผ่าน optocoupler/MOSFET เสมอ
3. ❌ **อย่าใช้ String class ใน firmware** — heap fragmentation จะทำให้ ESP32 ค้างหลังรันนานๆ
4. ❌ **อย่า dispense เหรียญโดยไม่ log ก่อน** — ไฟดับกลางคันจะนับไม่ตรง
5. ❌ **อย่าใช้ library ที่ไม่ maintain** — เลือกของ Adafruit, ESP32 official, หรือ npm package ที่มี star >1k + update ใน 1 ปี
6. ❌ **อย่าเขียนคอมเมนต์อธิบายว่าโค้ดทำอะไร** — เขียนเฉพาะ "ทำไม" ที่ไม่ obvious
7. ❌ **อย่าสร้างไฟล์ docs/markdown โดยไม่ได้ขอ** — ยกเว้นไฟล์ใน plan ที่ตกลงกันแล้ว
8. ❌ **อย่า assume ทุกอย่าง** — ถามถ้าไม่แน่ใจ โดยเฉพาะเรื่อง wiring, pinout, voltage

---

## 📐 รูปแบบการตอบ

### เมื่อเสนอ solution
1. **เป้าหมาย** — เข้าใจปัญหาก่อน
2. **ทางเลือก** — 2-3 ทาง พร้อม trade-off
3. **แนะนำ** — เลือกทางไหน เพราะอะไร
4. **Implementation** — code + อธิบาย

### เมื่อเขียน code
- มี comment เฉพาะ "why" ที่ไม่ obvious
- ตั้งชื่อตัวแปร/ฟังก์ชันให้ชัด ไม่ต้อง comment "what"
- ส่วน hardware-specific (pin, address) ใช้ `#define` / `const`
- error handling ที่จำเป็น (ไม่ over-engineer)

### เมื่อแก้บั๊ก
1. อธิบาย root cause
2. บอกว่าก่อนหน้านี้ทำไมพลาด (learning point)
3. แก้และ verify

---

## 🎓 หัวข้อที่อยากให้สอนไปด้วย

เมื่อหัวข้อต่อไปนี้ปรากฏใน work → ใช้โอกาสนี้สอน:

- **Interrupt vs Polling** — เมื่อเจอการอ่าน pulse
- **PWM / MOSFET driving** — เมื่อขับ hopper
- **Optocoupler isolation** — เมื่อต่อ NK77/sensor
- **Non-blocking patterns** — millis(), state machine
- **Serial protocol design** — newline-delimited JSON, framing, checksum
- **Persistent storage** — NVS, SQLite transactions, atomicity
- **Watchdog** — hardware vs software watchdog
- **Linux kiosk mode** — systemd, Chromium flags
- **Web security** — basic auth, CSRF, secure cookies

---

## 🔄 เมื่อ session ใหม่เริ่มต้น

1. อ่าน [CLAUDE.md](CLAUDE.md) — รู้บริบทโปรเจกต์
2. อ่านไฟล์นี้ — รู้วิธีทำงาน
3. ดู docs/ ที่เกี่ยวกับงานที่จะทำ
4. ถ้าไม่เข้าใจสภาพปัจจุบัน → ถามก่อน อย่าเดา

---

## 🛑 Hard Constraints (ต่อรองไม่ได้)

| Constraint | เหตุผล |
|---|---|
| ESP32 ต้องผ่าน optocoupler ทุกสัญญาณ ≥ 5V | ป้องกัน ESP32 พัง |
| Hopper ต้องมี flyback diode | inductive load จะทำให้ MOSFET พัง |
| Transaction ต้อง log ก่อน dispense | กันเงินหาย |
| Admin page ต้องมี auth | กันคน reset เหรียญฟรี |
| ESP32 ต้อง inhibit NK77 เมื่อ PC ขาด | กันรับเงินแล้วไม่จ่ายเหรียญ |
| ไม่ใช้ delay() ใน loop หลัก | กัน pulse ตกหล่น |
