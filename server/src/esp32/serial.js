import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

/**
 * SerialEsp32 — สื่อสารกับ ESP32 จริงผ่าน USB Serial
 *
 * Interface เหมือน MockEsp32:
 *   - emit 'event' ทุก JSON ที่ได้รับจาก ESP32
 *   - emit 'connected' / 'disconnected'
 *   - send(cmd) ส่ง JSON ไป ESP32
 *
 * Resilient:
 *   - reconnect อัตโนมัติทุก 3 วินาที ถ้าหลุด
 *   - ข้าม JSON ที่ parse ไม่ผ่าน (log warning)
 *
 * ⚠️  ยังไม่ test กับ ESP32 จริง — จะ test เมื่อมีบอร์ดมาแล้ว
 */
export class SerialEsp32 extends EventEmitter {
  constructor(path, baud) {
    super();
    this.path = path;
    this.baud = baud;
    this.connected = false;
    this._connect();
  }

  _connect() {
    this.port = new SerialPort({
      path: this.path,
      baudRate: this.baud,
      autoOpen: false,
    });

    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

    this.parser.on('data', (line) => this._onLine(line.trim()));

    this.port.on('open', () => {
      this.connected = true;
      this.emit('connected');
      console.log(`✅ ESP32 connected on ${this.path}`);
    });

    this.port.on('close', () => this._handleDisconnect('closed'));
    this.port.on('error', (err) => this._handleDisconnect(err.message));

    this.port.open((err) => {
      if (err) this._handleDisconnect(err.message);
    });
  }

  _onLine(line) {
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      this.emit('event', msg);
    } catch (err) {
      console.warn('⚠️  Bad JSON from ESP32:', line);
    }
  }

  _handleDisconnect(reason) {
    if (this.connected) {
      console.warn(`⚠️  ESP32 disconnected: ${reason}`);
      this.emit('disconnected');
    }
    this.connected = false;
    // reconnect after 3 วินาที
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connect(), 3000);
  }

  send(cmd) {
    if (!this.connected) return false;
    try {
      this.port.write(JSON.stringify(cmd) + '\n');
      return true;
    } catch (err) {
      console.error('Send failed:', err.message);
      return false;
    }
  }

  close() {
    clearTimeout(this._reconnectTimer);
    if (this.port?.isOpen) this.port.close();
    this.connected = false;
  }
}
