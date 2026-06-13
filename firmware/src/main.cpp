#include <Arduino.h>
#include <ArduinoJson.h>

// ── Pin definitions ────────────────────────────────────────────────────────────
#define BILL_PULSE_PIN   0    // GPIO0  = BOOT button (mock NK77 pulse)
#define COIN_SENSOR_PIN  4    // GPIO4  = coin sensor (mock: button to GND)
#define HOPPER_PIN      16    // GPIO16 = relay/MOSFET ขับ hopper (active HIGH)

// ── Timing constants ────────────────────────────────────────────────────────────
static const uint32_t HEARTBEAT_INTERVAL_MS = 1000;
static const uint32_t DEBOUNCE_MS           = 50;
static const uint32_t HOPPER_TIMEOUT_MS     = 3000;  // ไม่มีเหรียญออก 3s = jam

// ── Hopper state machine ────────────────────────────────────────────────────────
enum HopperState { IDLE, DISPENSING };

struct DispenseSession {
    int      target;       // เหรียญที่ต้องจ่าย
    int      count;        // จ่ายไปแล้ว
    uint32_t lastCoinMs;   // เวลาที่เหรียญออกล่าสุด (ใช้จับ timeout)
    uint32_t startMs;      // เวลาเริ่ม (ใช้คำนวณ duration_ms)
};

static HopperState     hopperState = IDLE;
static DispenseSession session     = {};

// ── State ──────────────────────────────────────────────────────────────────────
static uint32_t lastHeartbeat = 0;

// ISR ใช้ volatile เพราะเปลี่ยนค่าใน interrupt context
volatile bool     billPulseFlag    = false;
volatile uint32_t lastPulseMs      = 0;
volatile bool     coinSensorFlag   = false;
volatile uint32_t lastCoinSensorMs = 0;

// ── Serial read buffer ─────────────────────────────────────────────────────────
static char rxBuf[256];
static uint8_t rxIdx = 0;

// ── Forward declarations ────────────────────────────────────────────────────────
void sendHello();
void sendHeartbeat();
void sendBillPulse(int amount);
void sendCoinDispensed(int inSession);
void sendDispenseDone(int total, uint32_t durationMs);
void sendDispenseFailed(const char* reason, int dispensed, int expected);
void sendPong();
void sendAck(const char* cmd, bool ok, const char* error = nullptr);
void readSerial();
void handleLine(const char* line);
void handleCmd(const char* name, JsonDocument& doc);

void IRAM_ATTR onBillPulse();
void IRAM_ATTR onCoinSensor();

// ──────────────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    pinMode(BILL_PULSE_PIN,  INPUT_PULLUP);
    pinMode(COIN_SENSOR_PIN, INPUT_PULLUP);
    pinMode(HOPPER_PIN,      OUTPUT);
    digitalWrite(HOPPER_PIN, LOW);

    attachInterrupt(digitalPinToInterrupt(BILL_PULSE_PIN),  onBillPulse,  FALLING);
    attachInterrupt(digitalPinToInterrupt(COIN_SENSOR_PIN), onCoinSensor, FALLING);

    sendHello();
}

void loop() {
    uint32_t now = millis();

    // Heartbeat ทุก 1 วินาที (non-blocking)
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        sendHeartbeat();
    }

    // bill_pulse
    if (billPulseFlag) {
        billPulseFlag = false;
        sendBillPulse(10);
    }

    // coin sensor → นับเหรียญที่ออก
    if (coinSensorFlag) {
        coinSensorFlag = false;
        if (hopperState == DISPENSING) {
            session.count++;
            session.lastCoinMs = now;
            sendCoinDispensed(session.count);

            if (session.count >= session.target) {
                hopperState = IDLE;
                digitalWrite(HOPPER_PIN, LOW);
                sendDispenseDone(session.count, now - session.startMs);
            }
        }
    }

    // hopper timeout — ไม่มีเหรียญออก 3 วินาที = jam
    if (hopperState == DISPENSING && (now - session.lastCoinMs >= HOPPER_TIMEOUT_MS)) {
        hopperState = IDLE;
        digitalWrite(HOPPER_PIN, LOW);
        sendDispenseFailed("timeout", session.count, session.target);
    }

    // รับ command จาก PC
    readSerial();
}

// ── Outgoing messages ──────────────────────────────────────────────────────────

void sendHello() {
    StaticJsonDocument<128> doc;
    doc["type"]        = "hello";
    doc["fw"]          = "0.1.0";
    doc["boot_reason"] = "POWERON_RESET";
    doc["uptime"]      = 0;
    serializeJson(doc, Serial);
    Serial.println();
}

void sendHeartbeat() {
    StaticJsonDocument<128> doc;
    doc["type"]      = "event";
    doc["name"]      = "heartbeat";
    doc["uptime"]    = millis();
    doc["free_heap"] = esp_get_free_heap_size();
    serializeJson(doc, Serial);
    Serial.println();
}

// ── Incoming messages ──────────────────────────────────────────────────────────

// บัฟเฟอร์ทีละ byte จนเจอ '\n' แล้วส่งต่อ handleLine()
void readSerial() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n') {
            rxBuf[rxIdx] = '\0';
            if (rxIdx > 0) handleLine(rxBuf);
            rxIdx = 0;
        } else if (rxIdx < sizeof(rxBuf) - 1) {
            rxBuf[rxIdx++] = c;
        }
        // ถ้า buffer เต็ม (line > 255 bytes) → ทิ้งทั้งบรรทัดในรอบต่อไป
    }
}

void handleLine(const char* line) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, line);

    if (err) {
        Serial.print(F("{\"type\":\"event\",\"name\":\"error\",\"code\":\"BAD_JSON\"}\n"));
        return;
    }

    const char* type = doc["type"];
    const char* name = doc["name"];

    if (type == nullptr || name == nullptr) return;

    if (strcmp(type, "cmd") == 0) {
        handleCmd(name, doc);
    }
}

void handleCmd(const char* name, JsonDocument& doc) {
    if (strcmp(name, "ping") == 0) {
        sendPong();

    } else if (strcmp(name, "dispense") == 0) {
        int coins = doc["coins"] | 0;
        if (hopperState == DISPENSING) {
            sendAck("dispense", false, "ALREADY_DISPENSING");
        } else if (coins <= 0 || coins > 200) {
            sendAck("dispense", false, "INVALID_COIN_COUNT");
        } else {
            sendAck("dispense", true);
            hopperState        = DISPENSING;
            session.target     = coins;
            session.count      = 0;
            session.lastCoinMs = millis();
            session.startMs    = millis();
            digitalWrite(HOPPER_PIN, HIGH);
        }

    } else if (strcmp(name, "stop") == 0) {
        if (hopperState == DISPENSING) {
            hopperState = IDLE;
            digitalWrite(HOPPER_PIN, LOW);
            sendDispenseFailed("emergency_stop", session.count, session.target);
        }
        sendAck("stop", true);

    } else {
        sendAck(name, false, "UNKNOWN_CMD");
    }
}

void sendBillPulse(int amount) {
    StaticJsonDocument<96> doc;
    doc["type"]   = "event";
    doc["name"]   = "bill_pulse";
    doc["amount"] = amount;
    serializeJson(doc, Serial);
    Serial.println();
}

// ── ISR ────────────────────────────────────────────────────────────────────────
void IRAM_ATTR onBillPulse() {
    uint32_t now = millis();
    if (now - lastPulseMs < DEBOUNCE_MS) return;
    lastPulseMs   = now;
    billPulseFlag = true;
}

void IRAM_ATTR onCoinSensor() {
    uint32_t now = millis();
    if (now - lastCoinSensorMs < DEBOUNCE_MS) return;
    lastCoinSensorMs = now;
    coinSensorFlag   = true;
}

void sendCoinDispensed(int inSession) {
    StaticJsonDocument<128> doc;
    doc["type"]       = "event";
    doc["name"]       = "coin_dispensed";
    doc["count"]      = 1;
    doc["in_session"] = inSession;
    serializeJson(doc, Serial);
    Serial.println();
}

void sendDispenseDone(int total, uint32_t durationMs) {
    StaticJsonDocument<128> doc;
    doc["type"]        = "event";
    doc["name"]        = "dispense_done";
    doc["total"]       = total;
    doc["duration_ms"] = durationMs;
    serializeJson(doc, Serial);
    Serial.println();
}

void sendDispenseFailed(const char* reason, int dispensed, int expected) {
    StaticJsonDocument<128> doc;
    doc["type"]      = "event";
    doc["name"]      = "dispense_failed";
    doc["reason"]    = reason;
    doc["dispensed"] = dispensed;
    doc["expected"]  = expected;
    serializeJson(doc, Serial);
    Serial.println();
}

void sendPong() {
    Serial.print(F("{\"type\":\"event\",\"name\":\"pong\"}\n"));
}

void sendAck(const char* cmd, bool ok, const char* error) {
    StaticJsonDocument<128> doc;
    doc["type"] = "ack";
    doc["cmd"]  = cmd;
    doc["ok"]   = ok;
    if (error != nullptr) doc["error"] = error;
    serializeJson(doc, Serial);
    Serial.println();
}
