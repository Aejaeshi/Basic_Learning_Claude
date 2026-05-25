# 🚀 Deployment Guide — Setup ตู้ใหม่

> คู่มือนี้สำหรับ **bring up ตู้ใหม่ 1 ตู้** ตั้งแต่ hardware → software → online
> ใช้เวลา ~1-2 ชม (ถ้า hardware พร้อม)
>
> เหมาะกับทั้ง: เพิ่มตู้สาขาใหม่ของตัวเอง · ติดตั้งให้ลูกค้า · onboarding partner

---

## 📦 0. Checklist อุปกรณ์

ตรวจให้ครบก่อนเริ่ม (ดู [02-hardware.md](02-hardware.md) สำหรับ BOM เต็ม)

- [ ] PC (Core 2 Duo+ / 2GB RAM พอ)
- [ ] จอ 18" + สาย HDMI/VGA
- [ ] ESP32 DevKit V1 (WROOM-32E) + สาย USB
- [ ] NK77 Bill acceptor + power 12V
- [ ] 24V Coin Hopper + power 24V
- [ ] LG-JT02 sensor
- [ ] PC817 optocoupler (≥3 ตัว)
- [ ] MOSFET (IRLZ44N) + flyback diode (1N5408)
- [ ] สาย, breadboard/PCB, จัมเปอร์
- [ ] ตู้/กล่อง + กุญแจ

---

## 💻 1. OS install

### Lubuntu 22.04 (แนะนำ)
1. Download ISO → write USB ด้วย Rufus/balenaEtcher
2. Boot จาก USB → Install
3. ตั้ง:
   - Username: `coin` (หรือเลือกเอง)
   - Hostname: `coin-machine-{ชื่อตู้}` เช่น `coin-machine-A1`
   - Auto-login: **เปิด** (เพื่อให้ kiosk boot เข้า UI เลย)
4. หลัง install → `sudo apt update && sudo apt upgrade -y`

### Windows 10/11 (ทางเลือก สำหรับ test/dev)
- ใช้ได้แต่ใช้ resource มากกว่า + ติดปัญหา serial port driver
- ลง Node.js LTS จาก nodejs.org

---

## 🛠 2. Software dependencies

```bash
# Node.js 20 LTS (Lubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# ตรวจ
node -v   # ต้อง >=20
npm -v
git --version
```

### Driver ESP32 USB Serial

ESP32 DevKit V1 ใช้ chip `CP2102` (Silicon Labs) หรือ `CH340` (WCH) ขึ้นอยู่กับ batch:

```bash
# Lubuntu — ส่วนใหญ่มี driver มาแล้ว แค่เพิ่ม permission
sudo usermod -aG dialout $USER
# ออกจาก session แล้ว login ใหม่

# ตรวจว่า ESP32 มาเป็น /dev/ttyUSB0 หรือไม่
lsusb | grep -i 'silicon\|wch\|cp210'
ls /dev/ttyUSB*
```

ถ้าไม่เห็น `/dev/ttyUSB0`:
- ลองเสียบ USB ใหม่ → `dmesg | tail -20`
- CH340 อาจต้องโหลด driver: `sudo apt install ch341uart-dkms`

---

## 📥 3. Clone + setup project

```bash
cd ~
git clone https://github.com/Aejaeshi/Basic_Learning_Claude.git coin-machine
cd coin-machine/server
npm install
```

---

## ⚙️ 4. Configure `.env`

```bash
cp .env.example .env
nano .env   # หรือ vim/code
```

**ค่าที่ต้องตั้งจริงต่อตู้:**

```bash
# ===== Server =====
PORT=8080
NODE_ENV=production          # ⚠️ เปลี่ยนเป็น production ตอน deploy จริง

# ===== Machine identity =====
BRANCH_NAME=สาขา A           # ชื่อสาขา (ภาษาไทยได้)
MACHINE_NAME=ตู้ 1           # ชื่อตู้ภายในสาขา
MACHINE_ID=                  # ปล่อยว่าง → auto-gen UUID + save ที่ data/machine-id

# ===== ESP32 =====
ESP32_MODE=serial            # เปลี่ยนจาก mock → serial เมื่อ firmware พร้อม
ESP32_PORT=/dev/ttyUSB0      # หรือ COMx บน Windows
ESP32_BAUD=115200

# ===== Business =====
COIN_VALUE_BAHT=10
LOW_COIN_THRESHOLD=100       # แจ้ง Discord เมื่อเหรียญ ≤ 100

# ===== Admin =====
ADMIN_USERNAME=admin
# Gen hash password:
#   node -e "console.log(require('bcryptjs').hashSync('your-strong-password', 10))"
ADMIN_PASSWORD_HASH=<paste hash ที่ gen แล้ว>

# Gen session secret (random 64 hex):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=<paste hex ที่ gen แล้ว>

# ===== Discord =====
# สร้าง webhook: Discord channel → Edit Channel → Integrations → Webhooks → New Webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...
DISCORD_DAILY_SUMMARY_HOUR=23

# ===== DB =====
DB_PATH=./data/coin.db
```

---

## 🧪 5. First run + verify

```bash
# Start dev mode (auto reload)
npm run dev
```

ต้องเห็น log:
```
🚀 Server listening on http://localhost:8080
   หน้าจอลูกค้า: http://localhost:8080/customer/
   ESP32 mode:   serial
   Coin count:   0
🛠  Dev endpoints enabled at /dev/*
📣 Discord webhook enabled — daily summary at 23:00
```

### Verify checklist

ทดสอบทีละข้อ — ถ้าผ่านครบ = พร้อม deploy

- [ ] **Web เข้าได้:** เปิด browser http://localhost:8080/admin/login
- [ ] **Login ผ่าน:** ใช้ admin + password ที่ตั้ง
- [ ] **Health endpoint:** `curl http://localhost:8080/health` → `{"ok":true,...}`
- [ ] **Machine info:** `curl http://localhost:8080/api/machine-info` → เห็น `id`, `name`, `branch` ที่ตั้ง
- [ ] **Discord test:** ใน admin → ⚙️ ตั้งค่า → 🔔 ส่ง Test Message → ใน Discord เห็น `[สาขา A / ตู้ 1] ✅ Test message`
- [ ] **ESP32 connected:** ใน admin จุดสี ESP32 = เขียว (ถ้ายังไม่ flash firmware = แดง)
- [ ] **Customer page:** http://localhost:8080/customer/ — เห็นหน้า idle + label `สาขา A / ตู้ 1` ใต้ logo

---

## 🔥 6. Firewall (LAN access)

ถ้าต้องการเข้าจากมือถือ/PC อื่นใน LAN:

### Lubuntu (ufw)
```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

### Windows
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "Coin Server 8080" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
```

---

## 🌐 7. Network — Static IP (สำคัญ!)

⚠️ ตู้ที่ใช้ DHCP อาจได้ IP ใหม่ทุกครั้ง → bookmark พัง → manager เข้าไม่ได้

**แก้:** ตั้ง **DHCP Reservation** ในเรา router:
1. เข้าหน้า admin router (มักเป็น `http://192.168.1.1`)
2. หา MAC address ของ PC (ใน Lubuntu: `ip a | grep ether`)
3. ตั้ง: MAC `aa:bb:cc:...` ↔ IP `192.168.1.6` (ตัวอย่าง)

หรือตั้ง static IP บน OS โดยตรง (อ่าน Lubuntu network manager docs)

---

## 🔄 8. Auto-start ตอน boot (Production)

ตู้ต้อง start server อัตโนมัติเวลาไฟกลับมา — **ไม่ต้องให้ใครมา login**

### systemd (Lubuntu)

```bash
sudo nano /etc/systemd/system/coin-machine.service
```

วาง:
```ini
[Unit]
Description=Coin Exchange Machine Server
After=network.target

[Service]
Type=simple
User=coin
WorkingDirectory=/home/coin/coin-machine/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable coin-machine
sudo systemctl start coin-machine

# ตรวจสถานะ
sudo systemctl status coin-machine

# ดู log
sudo journalctl -u coin-machine -f
```

### Kiosk browser auto-start

ตั้งให้ Chromium เปิด `http://localhost:8080/customer/` แบบ fullscreen ทุกครั้ง boot:

```bash
# Lubuntu LXQt
mkdir -p ~/.config/autostart
nano ~/.config/autostart/coin-kiosk.desktop
```

```ini
[Desktop Entry]
Type=Application
Name=Coin Kiosk
Exec=chromium-browser --kiosk --noerrdialogs --disable-translate --no-first-run http://localhost:8080/customer/
X-GNOME-Autostart-enabled=true
```

---

## 🔌 9. Connect ESP32 + ทดสอบ end-to-end

> ⚠️ เลื่อนขั้นนี้ไว้หลังมี firmware ESP32 พร้อม (ดู [04-protocol.md](04-protocol.md))

1. Flash firmware ESP32 (PlatformIO / Arduino IDE)
2. ต่อ USB เข้า PC → ตรวจ `/dev/ttyUSB0` ขึ้น
3. แก้ `.env` → `ESP32_MODE=serial`
4. Restart: `sudo systemctl restart coin-machine`
5. ใน admin dashboard → ESP32 dot ต้องเป็นเขียว
6. ทดสอบ Test Dispense 1 เหรียญ → ฟังเสียง hopper หมุน

---

## 🧰 10. Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `EADDRINUSE :::8080` | มี process รันค้าง | `sudo lsof -i :8080` → `kill <pid>` |
| Discord ไม่แจ้ง | URL ผิด / network | curl URL จาก PC → ถ้า fail = network; ถ้า OK = URL ผิด |
| ESP32 disconnect บ่อย | สาย USB ห่วย / power ไม่พอ | เปลี่ยนสาย, ใช้ USB hub มี power |
| Bill acceptor ไม่กิน | ตู้ disabled / inhibit | เช็คใน admin → ปิดเครื่องชั่วคราว? / รับธนบัตรแต่ละชนิด |
| Login ไม่ผ่าน | hash ผิด | gen ใหม่ → paste ลง .env → restart |

---

## 📋 11. ตู้ใหม่ — Quick checklist (สำหรับคนเคยทำแล้ว)

```bash
# 1. Clone
git clone https://github.com/Aejaeshi/Basic_Learning_Claude.git coin-machine
cd coin-machine/server && npm install

# 2. Config
cp .env.example .env
# แก้: BRANCH_NAME, MACHINE_NAME, ADMIN_PASSWORD_HASH,
#      SESSION_SECRET, DISCORD_WEBHOOK_URL, ESP32_MODE

# 3. Test
npm run dev
# → เปิด http://localhost:8080/admin/login

# 4. Production
sudo cp ../docs/coin-machine.service /etc/systemd/system/
sudo systemctl enable --now coin-machine

# 5. Firewall
sudo ufw allow 8080/tcp

# 6. Verify
curl http://localhost:8080/api/machine-info
```

---

## 🔗 References

- [01-overview.md](01-overview.md) — ภาพรวมระบบ
- [02-hardware.md](02-hardware.md) — BOM + wiring
- [04-protocol.md](04-protocol.md) — PC ↔ ESP32 protocol
- [06-safety.md](06-safety.md) — Safety + watchdog
