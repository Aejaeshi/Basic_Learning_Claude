# Coin Exchange Server

Backend สำหรับตู้แลกเหรียญ — Node.js + Express + SQLite

## ความต้องการ

- Node.js >= 20 (ทดสอบบน 22)
- npm

## ติดตั้ง

```bash
cd server
npm install
cp .env.example .env
# แก้ค่าใน .env ตามต้องการ
```

## รัน

### โหมด development (ใช้ ESP32 mock)
```bash
npm run dev
```

จะใช้ mock ESP32 ใน process เดียวกัน — test ได้โดยไม่ต้องมีบอร์ดจริง

inject pulse ผ่าน HTTP:
```bash
# จำลองรับ 100 บาท (10 pulses)
curl -X POST http://localhost:8080/dev/inject-bill -H "Content-Type: application/json" -d '{"amount":100}'

# จำลองเหรียญออก
curl -X POST http://localhost:8080/dev/inject-coin
```

### โหมด production (ESP32 จริง)
```bash
ESP32_MODE=serial ESP32_PORT=/dev/ttyUSB0 npm start
```

## โครงสร้าง

```
server/
├── package.json
├── .env                ← ไม่ commit (เก็บ secrets)
├── .env.example
├── data/               ← SQLite file (ไม่ commit)
└── src/
    ├── index.js        ← entry point
    ├── config.js       ← env vars + defaults
    ├── db.js           ← SQLite + schema migration
    ├── schema.sql      ← DDL
    ├── esp32/
    │   ├── index.js    ← factory เลือก mock หรือ serial
    │   ├── mock.js     ← in-process mock
    │   └── serial.js   ← real USB serial
    ├── machine.js      ← business state machine
    ├── discord.js      ← webhook notifications
    └── routes/
        ├── customer.js ← / (UI ลูกค้า + WebSocket)
        ├── admin.js    ← /admin
        └── dev.js      ← /dev/* (mock control, dev only)
```

## Environment Variables

ดู `.env.example` — ทุกตัวมี default ใน [src/config.js](src/config.js)

## API Endpoints (สรุปย่อ)

### Customer
- `GET /` — หน้าจอลูกค้า
- `WS /ws` — WebSocket รับ state updates

### Admin (ต้อง login)
- `GET /admin/login`
- `POST /admin/login`
- `GET /admin/` — dashboard
- `POST /admin/coin/add` — เติมเหรียญ
- `POST /admin/inhibit` — enable/disable แบงค์
- `POST /admin/test-dispense` — ทดสอบจ่ายเหรียญ
- `GET /admin/transactions` — ดู log

### Dev (เปิดเฉพาะ `NODE_ENV !== 'production'`)
- `POST /dev/inject-bill` — จำลอง bill pulse
- `POST /dev/inject-coin` — จำลอง coin dispensed
- `POST /dev/reset` — reset state machine
