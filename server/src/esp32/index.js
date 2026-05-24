import { config } from '../config.js';
import { MockEsp32 } from './mock.js';
import { SerialEsp32 } from './serial.js';

// Factory เลือก transport ตาม config
// ทั้งสอง implement interface เดียวกัน (EventEmitter + send())
export function createEsp32() {
  if (config.esp32.mode === 'serial') {
    return new SerialEsp32(config.esp32.port, config.esp32.baud);
  }
  console.log('🤖 ESP32 ใน mock mode — inject events ผ่าน /dev/inject-*');
  return new MockEsp32();
}
