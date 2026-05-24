// ใช้ตอน dev — เติมเหรียญเริ่มต้นเข้า DB เพื่อ test ได้
import { coins, settings } from '../db.js';

const initial = Number(process.argv[2] || 1000);
const current = coins.current();
if (current === 0) {
  coins.add(initial, 'initial', 'seed-script');
  console.log(`✅ Seeded coin_count = ${initial}`);
} else {
  console.log(`coin_count already = ${current}, skipping`);
}
console.log('Settings:');
console.log('  low_threshold =', settings.getNumber('low_coin_threshold'));
console.log('  disabled      =', settings.getBool('machine_disabled'));
