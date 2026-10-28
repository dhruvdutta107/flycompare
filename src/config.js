'use strict';
const path = require('node:path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  // Where the SQLite file lives. On Render/Railway/Fly mount a persistent disk and point this at it.
  dbPath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'flycompare.db'),
  publicDir: path.join(__dirname, '..', 'public'),
  // Set TRUST_PROXY=1 when running behind a reverse proxy / PaaS load balancer (needed for HTTPS cookies + rate limits).
  trustProxy: env.TRUST_PROXY ? (isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : (isProd ? 1 : false),
  sessionDays: 30,
  holdMinutes: 20,          // how long a fare is held while the user completes checkout
  cookieName: 'fc_sid',
  // Set to "true" only when you want the Secure flag off in production (e.g. plain-HTTP demo on a LAN).
  insecureCookies: env.INSECURE_COOKIES === 'true',
  // Optional: enables Claude-written replies in the support chat. Without it the assistant uses built-in rules.
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.AI_MODEL || 'claude-haiku-5-5',
};
