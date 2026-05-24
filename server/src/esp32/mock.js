import { EventEmitter } from 'node:events';

/**
 * MockEsp32 — จำลอง ESP32 ใน process เดียวกับ backend
 *
 * ส่ง event ออกมาเหมือนของจริง:
 *   - 'event' (msg)  → ทุก message ที่ ESP32 ส่งขึ้นมา
 *   - 'hello'        → ตอน boot
 *   - 'connected'    → พร้อมรับคำสั่ง (จำลอง connection state)
 *   - 'disconnected' → ขาดการสื่อสาร
 *
 * รับ command ผ่าน send() เหมือนกับ real ESP32
 *
 * นอกจากนี้มี method สำหรับ test:
 *   - injectBillPulse(amount)   ← เรียกจาก /dev/inject-bill
 *   - injectCoinDispensed()     ← เรียกจาก /dev/inject-coin
 *   - injectError(code, msg)
 */
export class MockEsp32 extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.dispensing = false;
    this.dispenseTarget = 0;
    this.dispenseCount = 0;
    this.inhibitedDenoms = [];
    this.uptime = 0;

    // จำลอง boot delay
    setTimeout(() => this._boot(), 100);
  }

  _boot() {
    this.connected = true;
    this.emit('connected');
    this._send({ type: 'hello', fw: 'mock-0.1.0', boot_reason: 'POWERON_RESET', uptime: 0 });

    // heartbeat ทุก 1 วินาที
    this._heartbeatTimer = setInterval(() => {
      this.uptime++;
      this._send({ type: 'event', name: 'heartbeat', uptime: this.uptime, free_heap: 230000 });
    }, 1000);
  }

  // ===== Interface ที่ backend ใช้งาน =====

  send(cmd) {
    if (!this.connected) return false;
    // จำลอง processing delay 1-5ms
    setImmediate(() => this._handleCmd(cmd));
    return true;
  }

  close() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this._dispenseTimer) clearInterval(this._dispenseTimer);
    this.connected = false;
    this.emit('disconnected');
  }

  // ===== Internal =====

  _send(msg) {
    // จำลอง: ส่ง event ออกมาให้ backend ฟัง
    this.emit('event', msg);
  }

  _handleCmd(cmd) {
    if (cmd.type !== 'cmd') return;
    switch (cmd.name) {
      case 'dispense':
        this._startDispense(cmd.coins);
        break;
      case 'stop':
        this._stopDispense('emergency_stop');
        break;
      case 'inhibit':
        this.inhibitedDenoms = cmd.denoms || [];
        this._send({ type: 'ack', cmd: 'inhibit', ok: true });
        break;
      case 'enable_all':
        this.inhibitedDenoms = [];
        this._send({ type: 'ack', cmd: 'enable_all', ok: true });
        break;
      case 'disable_all':
        this.inhibitedDenoms = [20, 50, 100, 500, 1000];
        this._send({ type: 'ack', cmd: 'disable_all', ok: true });
        break;
      case 'ping':
        this._send({ type: 'event', name: 'pong' });
        break;
      case 'reboot':
        this._send({ type: 'ack', cmd: 'reboot', ok: true });
        this.close();
        setTimeout(() => this._boot(), 500);
        break;
      default:
        this._send({ type: 'ack', cmd: cmd.name, ok: false, error: 'UNKNOWN_CMD' });
    }
  }

  _startDispense(coins) {
    if (this.dispensing) {
      this._send({ type: 'ack', cmd: 'dispense', ok: false, error: 'ALREADY_DISPENSING' });
      return;
    }
    if (!coins || coins < 1 || coins > 200) {
      this._send({ type: 'ack', cmd: 'dispense', ok: false, error: 'INVALID_COIN_COUNT' });
      return;
    }
    this._send({ type: 'ack', cmd: 'dispense', ok: true });
    this.dispensing = true;
    this.dispenseTarget = coins;
    this.dispenseCount = 0;

    // จำลอง: เหรียญหล่นทุก 200ms
    this._dispenseTimer = setInterval(() => this._tickDispense(), 200);
  }

  _tickDispense() {
    if (!this.dispensing) return;
    this.dispenseCount++;
    this._send({
      type: 'event',
      name: 'coin_dispensed',
      count: 1,
      in_session: this.dispenseCount,
    });
    if (this.dispenseCount >= this.dispenseTarget) {
      this._finishDispense();
    }
  }

  _finishDispense() {
    clearInterval(this._dispenseTimer);
    this._send({
      type: 'event',
      name: 'dispense_done',
      total: this.dispenseCount,
      duration_ms: this.dispenseCount * 200,
    });
    this.dispensing = false;
    this.dispenseTarget = 0;
    this.dispenseCount = 0;
  }

  _stopDispense(reason = 'emergency_stop') {
    if (!this.dispensing) return;
    clearInterval(this._dispenseTimer);
    this._send({
      type: 'event',
      name: 'dispense_failed',
      reason,
      dispensed: this.dispenseCount,
      expected: this.dispenseTarget,
    });
    this.dispensing = false;
  }

  // ===== Test injection (called from /dev/* endpoints) =====

  injectBillPulse(amount = 10) {
    // ถ้าแบงค์ถูก inhibit → จำลอง NK77 ปฏิเสธ ไม่ส่ง pulse
    // (ตรงนี้ amount = บาทต่อ pulse = 10 เสมอ, ส่วน denom เป็นเรื่อง logic ฝั่ง PC)
    this._send({ type: 'event', name: 'bill_pulse', amount });
  }

  injectCoinDispensed() {
    // bypass internal state — ใช้สำหรับ test เฉพาะกรณี
    this._send({
      type: 'event',
      name: 'coin_dispensed',
      count: 1,
      in_session: ++this.dispenseCount,
    });
  }

  injectError(code, message) {
    this._send({ type: 'event', name: 'error', code, message });
  }
}
