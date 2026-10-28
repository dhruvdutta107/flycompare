'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');
const scrypt = promisify(crypto.scrypt);

// ---------- passwords ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
// Used to keep login timing similar whether or not the e-mail exists.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

// ---------- tokens ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// ---------- cookies ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}
function sessionCookie(req, value, maxAgeSec) {
  const secure = req.secure && !config.insecureCookies;
  return `${config.cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// ---------- security headers (CSP, etc.) ----------
function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https://images.unsplash.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.removeHeader('X-Powered-By');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  next();
}

// ---------- CSRF-style guard for state-changing API calls ----------
// Browsers cannot send a custom header cross-site without a CORS pre-flight (which we never allow),
// and cookies are SameSite=Lax, so requiring this header + a matching Origin blocks cross-site forgery.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host; try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'forbidden', message: 'Cross-origin request blocked.' });
  }
  if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'forbidden', message: 'Missing request header.' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'unsupported_media_type', message: 'Send JSON.' });
  next();
}

// ---------- tiny in-memory rate limiter (per IP + bucket) ----------
function rateLimit({ windowMs, max, bucket, message = 'Too many requests. Please slow down and try again shortly.' }) {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, Math.min(windowMs, 60000));
  timer.unref();
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`; const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - h.count)));
    if (h.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', message });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, sha256, newToken, parseCookies, sessionCookie, securityHeaders, csrfGuard, rateLimit };
