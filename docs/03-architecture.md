# 03 — Software Architecture

> โครงสร้าง software ทั้ง PC และ ESP32 + เหตุผลที่แบ่งแบบนี้

---

## 1. หลักการออกแบบ

### 1.1 Separation of Concerns
- **ESP32** = real-time I/O (อ่าน pulse, ขับ motor) — งานที่ต้องตอบสนองใน µs
- **PC** = business logic (calculate, log, UI, network) — งานที่ใช้ทรัพยากรเยอะ
- **ทั้งสองคุยกันผ่าน JSON ทีละบรรทัด** ผ่าน USB Serial

### 1.2 Why แบ่งแบบนี้
- เปลี่ยน UI ทีหลังได้ไม่ต้อง flash firmware ใหม่
- เพิ่ม QR Payment ในอนาคต = แค่เพิ่ม module บน PC (ESP32 ไม่รู้เลย)
- ESP32 code สั้น → bugs น้อย → reliability สูง
- ถ้า PC ค้าง ESP32 จะ inhibit NK77 อัตโนมัติ (safe fail)

---

## 2. ESP32 Firmware

### 2.1 Tech Stack
- **Arduino framework** (ไม่ใช่ ESP-IDF — เพื่อความง่าย)
- **PlatformIO** (ไม่ใช่ Arduino IDE — version control + library deps ดีกว่า)
- **Libraries:**
  - `ArduinoJson` (parse/serialize JSON)
  - `Preferences` (NVS storage)

### 2.2 โครงสร้างโฟลเดอร์
```
firmware/
├── platformio.ini
├── src/
│   ├── main.cpp              ← setup() + loop()
│   ├── config.h              ← #define pins
│   ├── pulse_counter.h/cpp   ← นับ pulse จาก NK77 + LG-JT02 (ISR)
│   ├── hopper.h/cpp          ← ควบคุม motor + state
│   ├── inhibit.h/cpp         ← ส่งสัญญาณ INHIBIT แบงค์
│   ├── protocol.h/cpp        ← JSON over Serial
│   └── watchdog.h/cpp        ← ตรวจ heartbeat จาก PC
└── README.md
```

### 2.3 Main loop (pseudo)
```cpp
void loop() {
  protocol.readIncomingCommands();   // อ่าน JSON จาก PC
  pulse_counter.flushQueuedEvents(); // ส่ง pulse events ที่ ISR queue ไว้
  hopper.tick();                      // state machine ของ hopper
  watchdog.tick();                    // ตรวจ heartbeat
  
  // ⚠️ ห้ามมี delay() — ทุกอย่าง non-blocking
}
```

### 2.4 Pulse counting (Interrupt-driven)
```cpp
volatile uint32_t nk77_pulse_count = 0;
volatile uint32_t hopper_coin_count = 0;

void IRAM_ATTR nk77_isr() { nk77_pulse_count++; }
void IRAM_ATTR hopper_isr() { hopper_coin_count++; }

// ใน setup():
attachInterrupt(NK77_PIN,  nk77_isr,  FALLING);
attachInterrupt(HOPPER_PIN,hopper_isr,FALLING);
```

> 💡 **ทำไมต้อง interrupt:** NK77 ส่ง pulse กว้างแค่ 50ms ถ้า polling แล้ว loop ติด delay จะตกหล่น
> 💡 **ทำไม IRAM_ATTR:** ISR ต้อง execute จาก IRAM ไม่ใช่ flash (เร็วกว่า + safe)
> 💡 **ทำไม volatile:** บอก compiler ว่าค่าตัวแปรอาจเปลี่ยนนอก control flow (จาก ISR)

### 2.5 Hopper state machine
```
IDLE ──[cmd dispense N]──► DISPENSING
                                │
                                ├──[coin counted == N]──► DONE ──► IDLE
                                ├──[timeout 3s no coin]──► JAMMED
                                └──[cmd stop]──► STOPPED
```

---

## 3. PC Backend (Node.js)

### 3.1 Tech Stack
- **Node.js 20 LTS** (เบา เร็ว มี npm)
- **Express** (HTTP server สำหรับ UI + Admin)
- **serialport** (สื่อสารกับ ESP32)
- **better-sqlite3** (DB, sync API ใช้ง่ายกว่า async)
- **ws** (WebSocket — UI update real-time)
- **node-fetch** (Discord webhook)
- **bcrypt** (hash admin password)
- **express-session** (admin login)

### 3.2 โครงสร้างโฟลเดอร์
```
server/
├── package.json
├── src/
│   ├── index.js              ← entry, start express + serialport
│   ├── config.js             ← load .env, defaults
│   ├── db.js                 ← SQLite setup + migrations
│   ├── esp32.js              ← serial bridge (JSON line protocol)
│   ├── machine.js            ← business logic state machine
│   ├── discord.js            ← webhook notifications
│   ├── routes/
│   │   ├── customer.js       ← / (หน้าจอลูกค้า + WebSocket)
│   │   └── admin.js          ← /admin (auth + settings + logs)
│   └── views/                ← (option) server-side templates
├── public/                   ← static files served by Express
│   ├── customer/
│   │   ├── index.html        ← UI ลูกค้า
│   │   ├── style.css         ← Tailwind compiled
│   │   └── app.js            ← WebSocket client
│   └── admin/
│       ├── index.html
│       └── app.js
├── data/
│   └── coin.db               ← SQLite file
└── .env                      ← DISCORD_WEBHOOK_URL, ADMIN_PASSWORD
```

### 3.3 Business state machine (PC)
```
IDLE ──[bill_pulse จาก ESP32]──► RECEIVING (timer 2s)
                                      │
                                      ├──[pulse อีก]──► reset timer
                                      └──[timer หมด]──► DISPENSING
                                                            │
                                                  [ส่ง cmd dispense]
                                                            │
                                                            ├──[coins ครบ]──► COMPLETED ──► IDLE
                                                            └──[jam/error]──► ERROR
```

### 3.4 ทำไม Node.js (ไม่ใช่ Python)
| | Node.js | Python |
|---|---|---|
| Serial port | `serialport` มี event-driven ดี | `pyserial` ต้อง polling thread |
| WebSocket | native (ws) | ต้องเพิ่ม uvicorn/websockets |
| RAM ใช้ | 50–80MB | 60–120MB |
| Single file deploy | pkg ได้ | ยุ่ง |
| ความคุ้นเคยคนทั่วไป | สูง (เหมือน JS browser) | สูง |

> สรุป: Node.js ตอบโจทย์ event-driven I/O ของโปรเจกต์นี้มากกว่า

### 3.5 ทำไมไม่ใช้ React/Vue
- PC เก่า Core 2 Duo + 2GB RAM → Chromium รัน React heavy ไม่ไหว
- UI ไม่ซับซ้อน — แค่แสดงตัวเลข + animation
- Vanilla JS + Tailwind = bundle เล็ก, load เร็ว, debug ง่าย
- ลด dependency = ลดจุดพัง

---

## 4. ระบบสื่อสาร PC ↔ ESP32

### 4.1 Physical
- USB cable ตรง (USB-A ↔ Micro-USB)
- บน Linux: `/dev/ttyUSB0` (CP2102) หรือ `/dev/ttyACM0` (CH340)
- Baud: **115200**

### 4.2 Logical Protocol
- **Newline-delimited JSON** (NDJSON)
- ทุก message ขึ้นบรรทัดใหม่
- ไม่มี handshake, ไม่มี checksum (USB เชื่อถือได้ระดับนึง)
- Heartbeat ทุก 1 วินาทีจาก ESP32 → PC

ตัวอย่างการสนทนา:
```
ESP32 → PC: {"type":"hello","fw":"1.0.0"}
PC → ESP32: {"type":"cmd","name":"inhibit","denoms":[]}
PC → ESP32: {"type":"cmd","name":"enable_all"}
ESP32 → PC: {"type":"event","name":"heartbeat","uptime":5}
ESP32 → PC: {"type":"event","name":"bill_pulse","amount":10}
ESP32 → PC: {"type":"event","name":"bill_pulse","amount":10}
PC → ESP32: {"type":"cmd","name":"dispense","coins":2}
ESP32 → PC: {"type":"event","name":"coin_dispensed","count":1}
ESP32 → PC: {"type":"event","name":"coin_dispensed","count":2}
ESP32 → PC: {"type":"event","name":"dispense_done","total":2}
```

ละเอียดเต็มๆ → [04-protocol.md](04-protocol.md)

---

## 5. ระบบสื่อสาร Browser ↔ PC

### 5.1 หน้าจอลูกค้า
- เปิด `http://localhost:8080/`
- เปิดด้วย **Chromium kiosk mode** เต็มจอ
- เชื่อมต่อ **WebSocket** ที่ `ws://localhost:8080/ws` รับ event push
- ไม่มี user input — display only

### 5.2 หน้า Admin
- เปิด `http://<pc-ip>:8080/admin` จาก laptop/มือถือใน LAN
- Login ด้วย password (express-session + bcrypt)
- ใช้ REST API + form post (ไม่ต้อง WebSocket — refresh เอาก็พอ)

---

## 6. Auto-start บน Lubuntu

### 6.1 Backend (systemd service)
ไฟล์ `/etc/systemd/system/coin-exchange.service`:
```ini
[Unit]
Description=Coin Exchange Backend
After=network.target

[Service]
Type=simple
User=coin
WorkingDirectory=/opt/coin-exchange/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/coin-exchange.log
StandardError=append:/var/log/coin-exchange.err

[Install]
WantedBy=multi-user.target
```

### 6.2 Chromium Kiosk (auto-start เมื่อ login)
ไฟล์ `~/.config/autostart/coin-ui.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=Coin Exchange UI
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 http://localhost:8080/
```

หรือใช้ `cage` (Wayland kiosk compositor) ถ้าอยากเบากว่า

### 6.3 ปิดการทำงานที่ไม่จำเป็น
- ปิด screen saver
- ปิด auto-update
- ปิด notification
- ตั้ง auto-login user `coin`

---

## 7. Data Flow ตัวอย่าง (ใส่ 100฿ จ่าย 10 เหรียญ)

```
1. ลูกค้าใส่ 100฿
2. NK77 ส่ง 10 pulses (50ms each)
3. ESP32 ISR เพิ่ม pulse counter ทีละครั้ง
4. main loop flush queue → ส่ง {"type":"event","name":"bill_pulse","amount":10} × 10 ครั้ง
5. PC machine.js สะสม total = 100 บาท, reset timer 2s ทุก pulse
6. WebSocket push → Browser update ตัวเลข real-time
7. ไม่มี pulse 2 วินาที → PC เริ่ม DISPENSING
8. PC log to SQLite: transaction start (bills=100)
9. PC ส่ง {"type":"cmd","name":"dispense","coins":10}
10. ESP32 set hopper state DISPENSING, เปิด MOSFET
11. Hopper หมุน, เหรียญผ่าน LG-JT02 → ISR เพิ่ม coin_count
12. ทุก coin → ส่ง {"type":"event","name":"coin_dispensed","count":N}
13. WebSocket push → Browser update progress bar
14. ครบ 10 → ESP32 ปิด MOSFET → ส่ง dispense_done
15. PC log: transaction complete, coin_count -= 10
16. (ถ้า coin_count ≤ threshold) ส่ง Discord notification
17. WebSocket push "completed" → Browser แสดง "ขอบคุณค่ะ"
18. หลัง 5 วินาที → กลับหน้า idle
```

---

## 8. ความปลอดภัย (เบื้องต้น — รายละเอียดดู 06-safety.md)

| Layer | Mechanism |
|---|---|
| Network | Backend bind `0.0.0.0:8080` แต่ admin route require auth |
| Admin auth | bcrypt password hash, session cookie (httpOnly, secure if HTTPS) |
| Discord webhook URL | เก็บใน `.env` ไม่ commit เข้า git |
| SQLite | ไฟล์ใน `/opt/coin-exchange/data/` permission 600 |
| ESP32 watchdog | PC ขาด heartbeat 5s → inhibit NK77 |
| Audit log | ทุก admin action บันทึก in events table |
