# 📋 Progress Tracker

> สถานะโปรเจกต์ตู้แลกเหรียญ — เปิดอ่านทุกครั้งที่กลับมาทำงาน
> **Last updated:** 2026-05-24

---

## ✅ งานที่ทำเสร็จแล้ว

### Phase 0 — Documentation
- [x] `docs/01-overview.md` — ภาพรวมระบบ
- [x] `docs/02-hardware.md` — BOM + wiring + แรงดัน
- [x] `docs/03-architecture.md` — software architecture
- [x] `docs/04-protocol.md` — JSON serial protocol PC↔ESP32
- [x] `docs/05-workflow.md` — state machine การแลก
- [x] `docs/06-safety.md` — safety / watchdog / error handling

### Phase 1 — Backend skeleton (`server/`)
- [x] Express + WebSocket + SQLite (`better-sqlite3`)
- [x] `server/src/config.js` — env config + validateConfig
- [x] `server/src/db.js` — settings / coins / events / transactions + `summary()` aggregator
- [x] `server/src/schema.sql` — tables: settings, coin_refills, transactions, events
- [x] `server/src/machine.js` — state machine (IDLE/RECEIVING/DISPENSING/ERROR/DISABLED/OFFLINE)
  - Bill pulse debounce (2 วินาที)
  - Coin availability double-check ก่อน dispense
  - Power-loss recovery (`findInProgress` + auto-complete as `power_loss_recovered`)
- [x] `server/src/esp32/{index,mock,serial}.js` — driver พร้อม mock mode
- [x] `server/src/ws.js` — WebSocket broadcast state changes

### Phase 2 — Customer UI
- [x] `server/public/customer/{index,app}.{html,js}` — kiosk display
  - 7 scenes: idle / receiving / dispensing / completed / error / disabled / offline
  - Animations: coin-spin (idle), breathe (idle/offline), flash (number change)
  - **Coin rain** ตอน dispensing — `dropCoin()` ใน app.js push เหรียญ ฿10 ทุกครั้ง
    ที่ `coinsDispensed` เพิ่ม sync กับ progress bar
  - Progress bar, status pill, connection indicator
  - WebSocket-driven live state updates

### Phase 3 — Admin dashboard + Auth ⭐
- [x] `server/src/auth.js` — bcrypt verify + session + rate-limit
- [x] `server/src/routes/admin.js` — REST endpoints:
  - POST /admin/login + logout (rate-limited)
  - GET  /admin/api/state — snapshot ทั้ง machine + inhibits
  - POST /admin/api/coins — delta or absolute set
  - POST /admin/api/inhibit — per-denom bill inhibit { denom, on }
  - POST /admin/api/disable — machine-wide on/off
  - POST /admin/api/clear-error
  - POST /admin/api/test-dispense — bypass state machine
  - POST /admin/api/test-discord — ส่ง webhook test
  - POST /admin/api/settings — low_coin_threshold
  - GET  /admin/api/transactions, /admin/api/events
- [x] `server/public/admin/login.html` — Login card
- [x] `server/public/admin/index.html` — Dashboard
- [x] `server/public/admin/app.js` — REST + WebSocket live updates

### Phase 3.5 — UX iterations (จากการใช้งานจริง)
- [x] Coin management: ลบ quick +/- buttons, เหลือแค่ "กำหนดจำนวนเอง"
- [x] ปุ่ม `= ตั้งค่า` → `ยืนยัน` (สีเหลือง action หลัก)
- [x] **Incremental + / − semantics**: field = typed delta, +/- เลือก sign + preview text
  ใต้ช่อง, ยืนยัน → `addCoins(±delta)` (ไม่ใช่ setCoins absolute)
- [x] Per-denom inhibit: switch สีเขียว=เปิด / **แดง**=ปิด (เดิมเทา) + tap target ทั้ง row
- [x] section "🔧 ทดสอบ / ควบคุม": help text แยก Test dispense vs ปิดเครื่อง (ลด confusion)

### Phase 4 — Mobile responsive 📱
- [x] Header `flex-wrap`, title truncate, ซ่อน username บนจอ <sm
- [x] Coin row: `grid-cols-3 sm:flex` (input เต็มแถวบนมือถือ, 3 ปุ่ม 3 col ใต้)
- [x] Threshold + test-dispense: `flex-col sm:flex-row` stack บนมือถือ
- [x] ทุก number input: `inputmode="numeric"` → iOS numpad
- [x] ทุก tap target: `min-h-[44px] py-3` (Apple HIG)
- [x] Bill inhibit switch ขยาย `w-16 h-9` + ทั้ง row คลิกได้ + keyboard support
- [x] Firewall rule `Coin Server 8080` เปิดสำหรับ LAN access
- [x] ทดสอบเปิดบนมือถือผ่าน `http://192.168.1.6:8080/admin/login` ใช้งานได้

### Phase 5 — Discord webhook 📣
- [x] `server/src/discord.js` — webhook poster + dedupe 5 นาที + timeout 8s
- [x] 5 helpers: `notifyLowCoin` / `notifyError` / `notifyEsp32` / `notifyDailySummary` / `test`
- [x] Wire ใน `index.js`: low_coin, error_occurred, esp32 connect/disconnect
- [x] Daily summary scheduler (setInterval 60s, send once/day, ใช้ `discord_last_summary_date` กันส่งซ้ำ)
- [x] ปุ่ม "🔔 ส่ง Test Message" ใน admin UI
- [x] Webhook URL ตั้งใน `.env` แล้ว → ทดสอบส่งข้อความเข้า Discord ได้จริง

---

## ❌ งานที่ยังค้าง

### 🎯 ทำต่อ (เรียงตามความสำคัญ)

#### Path B — Firmware ESP32 (งานใหญ่สุดที่เหลือ) ⚠️ CRITICAL
ไม่มี folder `firmware/` เลย ต้องสร้างใหม่หมด
- [ ] เลือกเครื่องมือ: **Arduino IDE** หรือ **PlatformIO** (แนะนำ PlatformIO — version control ง่ายกว่า)
- [ ] `firmware/src/main.cpp`:
  - [ ] Pulse counter จาก NK77 (interrupt-driven, debounce)
  - [ ] JSON parser/serializer (ArduinoJson lib)
  - [ ] Serial command handler (newline-delimited JSON @ 115200)
  - [ ] Dispense state machine (counting pulses จาก LG-JT02 sensor)
  - [ ] Heartbeat ทุก 1 วินาที → PC
  - [ ] Watchdog: ถ้าไม่ได้รับ command จาก PC > 5 วิ → inhibit NK77 + stop hopper
  - [ ] Optocoupler input handling (12-24V → 3.3V)
  - [ ] MOSFET + flyback diode สำหรับ hopper 24V
- [ ] ทดสอบกับ mock ก่อน — server มี mock mode พร้อมอยู่แล้ว
- [ ] ทดสอบ serial loopback (ESP32 echo) ก่อนต่อ NK77 จริง

#### ทดสอบ Serial PC ↔ ESP32 จริง
- [ ] เปลี่ยน `.env` → `ESP32_MODE=serial`, `ESP32_PORT=/dev/ttyUSB0` (Linux) หรือ `COM5` (Windows ทดสอบ)
- [ ] ตรวจ `serialport` driver — บางทีต้องลง driver CP210x หรือ CH340 ก่อน
- [ ] ตรวจ permissions: `sudo usermod -a -G dialout $USER` (Linux)

### 🔧 งานเล็กๆ (เก็บกวาด)

- [ ] **Automated tests** — ตอนนี้ไม่มี test suite เลย (`server/package.json` ไม่มี script `test`,
      ไม่มี folder `test/` หรือ `__tests__/`)
      - แนะนำ: เริ่มจาก unit test ของ `machine.js` (state transitions, error paths)
      - และ integration test ของ `routes/admin.js` (ผ่าน supertest)
- [ ] Discord notification: option mute ESP32 events ใน dev mode (ตอนนี้ส่งทุก restart)
- [ ] Export CSV / charts รายวันใน admin
- [ ] HTTPS (สำคัญตอน production — ตอนนี้ password ส่ง plain ใน LAN)
- [ ] Static IP (DHCP reservation ใน router) — ตอนนี้ใช้ 192.168.1.6 อาจเปลี่ยน

### 🛒 Hardware ที่ต้องเตรียม

ดู `docs/02-hardware.md` มี BOM ครบ ตัวที่ยังขาด/ยังไม่ confirm:
- [ ] ❓ LG-JT02 sensor: NPN หรือ PNP? (กระทบวงจร pull-up/down)
- [ ] ❓ ปุ่มกายภาพ (Reset / Manual dispense / Admin key) — ตัดสินใจไหม?
- [ ] ❓ UPS สำหรับ PC — กันไฟดับกลาง transaction
- [ ] ❓ ตำแหน่งติดตั้งจริง — มี WiFi ไหม? กุญแจล็อกตู้?

---

## 🚀 วิธี Resume

### 1. Start dev server
```powershell
cd D:\Basic_Learning_Claude\server
npm run dev
```
ต้องเห็น:
```
🚀 Server listening on http://localhost:8080
📣 Discord webhook enabled — daily summary at 23:00
🛠  Dev endpoints enabled at /dev/*
```

### 2. URLs ใช้บ่อย
| | PC | มือถือ (LAN) |
|---|---|---|
| Customer | http://localhost:8080/customer/ | http://192.168.1.6:8080/customer/ |
| Admin login | http://localhost:8080/admin/login | http://192.168.1.6:8080/admin/login |
| Health | http://localhost:8080/health | http://192.168.1.6:8080/health |

⚠️ IP `192.168.1.6` อาจเปลี่ยน — ถ้าเปิดไม่ได้ run `ipconfig` เช็คใหม่

### 3. Admin credentials
อยู่ใน `server/.env` (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`)

### 4. ตัวอย่างทดสอบ Discord
- กดปุ่ม "🔔 ส่ง Test Message" ในหน้า admin
- หรือลดค่า threshold ให้สูงกว่า coin count → save → จะแจ้ง low coin ทันที

---

## 🗂️ Decisions ที่ตัดสินใจแล้ว (ห้ามเปลี่ยน)

จาก `CLAUDE.md`:
- เหรียญ 10 บาทเท่านั้น (1 pulse = 1 เหรียญ)
- Bill denoms: 20, 50, 100, 500, 1000
- แจ้งเตือน Discord (ไม่ใช่ LINE)
- ESP32 DevKit V1 + WROOM-32E (ECO V3)
- PC ↔ ESP32 ผ่าน USB Serial (ไม่ใช่ WiFi)
- จอ 18" ไม่มี touch → display-only ลูกค้าไม่กด
- SQLite (ไฟล์เดียว)
- Frontend: HTML + Tailwind + Vanilla JS (ไม่ใช้ React)
- Backend: Node.js + Express + serialport

จากการพัฒนาที่ผ่านมา:
- Admin auth ใช้ bcrypt + express-session + express-rate-limit
- Discord embed สี: เหลือง=warn, แดง=error, เขียว=success, น้ำเงิน=info
- Dedupe Discord 5 นาทีต่อ key
- Mobile responsive: Tailwind `sm:` breakpoint (640px) เป็นหลัก
- Tap target ≥ 44px (Apple HIG)
- Per-denom inhibit: เขียว=เปิด / แดง=ปิด (ไม่ใช่ทาง master switch)

---

## 📊 Git history
```
3359352 feat: Discord webhook for low-coin, errors, ESP32 status, daily summary
5315449 feat: admin dashboard with auth, bill inhibit, coin mgmt — mobile-responsive
b2f6bf4 feat: backend server skeleton + customer UI with WebSocket
6159a66 docs: initial project documentation for coin exchange machine
5a845a4 Initial commit
```

Working tree clean — ทุกอย่าง push ขึ้น GitHub แล้ว ✅
