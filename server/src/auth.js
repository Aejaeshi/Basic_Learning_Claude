import bcrypt from 'bcryptjs';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { events } from './db.js';

/**
 * Session middleware — cookie-based, httpOnly, sameSite=strict
 *
 * ⚠️ SECURITY:
 * - secret มาจาก env (validateConfig() บังคับให้ไม่ใช่ default ใน production)
 * - sameSite=strict → กัน CSRF จากเว็บอื่น
 * - secure=true ในอนาคตเมื่อใช้ HTTPS
 */
export const sessionMiddleware = session({
  name: 'coin.sid',
  secret: config.admin.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction && process.env.HTTPS === 'true',
    maxAge: 30 * 60 * 1000,        // 30 นาที
  },
});

/**
 * Rate limit สำหรับ login — 5 ครั้งใน 1 นาที ต่อ IP
 * กัน brute-force password
 */
export const loginRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again in a minute' },
});

/**
 * Verify username + password
 * Returns true/false (constant time via bcrypt)
 */
export async function verifyCredentials(username, password) {
  if (username !== config.admin.username) {
    // ⚠️ ยังต้อง compare ปลอม เพื่อกัน timing attack
    await bcrypt.compare(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsalt');
    return false;
  }
  if (!config.admin.passwordHash) return false;
  return bcrypt.compare(password, config.admin.passwordHash);
}

/**
 * Middleware: ต้อง login ก่อน
 * - GET request ที่ไม่ใช่ /admin/login → redirect ไป login
 * - JSON/POST request → 401
 */
export function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  events.log('warn', 'admin', 'unauthorized_access', {
    path: req.path, ip: req.ip,
  });
  if (req.accepts('html') && !req.xhr) {
    return res.redirect('/admin/login');
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
