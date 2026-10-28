'use strict';
/**
 * Database access with two interchangeable drivers behind one small async API:
 *
 *   await db.get(sql, params)  -> first row or null
 *   await db.all(sql, params)  -> array of rows
 *   await db.run(sql, params)  -> { changes, rows }   (use `RETURNING ...` to read generated ids)
 *   await db.close()
 *
 * SQL is written once, in PostgreSQL style with $1, $2 ... placeholders.
 *
 *  - Supabase / PostgreSQL (production): set DATABASE_URL to the project's connection string.
 *  - SQLite (built into Node, zero setup): used when DATABASE_URL is not a postgres URL - handy for local
 *    development and for `npm test`, which runs against an in-memory database.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const SCHEMA_PG_FILE = path.join(__dirname, '..', 'supabase', 'schema.sql');

// ---------------------------------------------------------------- PostgreSQL (Supabase)
function openPostgres(url) {
  let pg;
  try { pg = require('pg'); } catch {
    throw new Error('DATABASE_URL points to PostgreSQL but the "pg" package is not installed. Run `npm install`.');
  }
  // int8/bigint columns (ids, epoch-millisecond timestamps) come back as strings by default; they fit in a JS number here.
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  const ssl = config.dbSsl === false ? false
    : config.dbCaCert ? { ca: fs.readFileSync(config.dbCaCert, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false }; // encrypted; add DATABASE_CA_CERT to also verify Supabase's certificate
  const pool = new pg.Pool({ connectionString: url, ssl, max: config.dbPoolSize, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));

  const db = {
    kind: 'postgres',
    async all(sql, params = []) { return (await pool.query(sql, params)).rows; },
    async get(sql, params = []) { return (await pool.query(sql, params)).rows[0] || null; },
    async run(sql, params = []) { const r = await pool.query(sql, params); return { changes: r.rowCount, rows: r.rows }; },
    async ready() {
      if (config.dbAutoMigrate) await pool.query(fs.readFileSync(SCHEMA_PG_FILE, 'utf8')); // idempotent: CREATE TABLE IF NOT EXISTS ...
      await pool.query('select 1');
      return db;
    },
    close: () => pool.end(),
  };
  return db;
}

// ---------------------------------------------------------------- SQLite (local dev + tests)
const SCHEMA_SQLITE = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS bookings (
    token TEXT PRIMARY KEY, pnr TEXT UNIQUE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired')),
    trip_type TEXT NOT NULL, cabin TEXT NOT NULL, adults INTEGER NOT NULL, children INTEGER NOT NULL, infants INTEGER NOT NULL,
    legs_json TEXT NOT NULL, passengers_json TEXT, contact_email TEXT COLLATE NOCASE, contact_phone TEXT,
    base_amount INTEGER NOT NULL, taxes INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
    promo_code TEXT, payment_json TEXT, pay_attempts INTEGER NOT NULL DEFAULT 0, refund_amount INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at INTEGER NOT NULL,
    confirmed_at TEXT, cancelled_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_bookings_user  ON bookings(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(contact_email);
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_token TEXT NOT NULL REFERENCES bookings(token) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('checkin','leave','custom')), leg_index INTEGER NOT NULL DEFAULT 0,
    minutes_before INTEGER NOT NULL, remind_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE INDEX IF NOT EXISTS idx_reminders_booking ON reminders(booking_token);`;

function openSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA_SQLITE);
  const cache = new Map();
  // $1 -> ?1 (SQLite numbered parameters), and drop Postgres-only casts such as ::jsonb
  const prep = (sql) => {
    let st = cache.get(sql);
    if (!st) { st = raw.prepare(sql.replace(/\$(\d+)/g, '?$1').replace(/::(jsonb|text|bigint|int)\b/g, '')); cache.set(sql, st); }
    return st;
  };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
  const db = {
    kind: 'sqlite',
    async all(sql, params = []) { return prep(sql).all(...norm(params)); },
    async get(sql, params = []) { return prep(sql).get(...norm(params)) || null; },
    async run(sql, params = []) {
      if (/\breturning\b/i.test(sql)) { const rows = prep(sql).all(...norm(params)); return { changes: rows.length, rows }; }
      const r = prep(sql).run(...norm(params)); return { changes: Number(r.changes), rows: [] };
    },
    async ready() { return db; },
    async close() { raw.close(); },
  };
  return db;
}

/** Opens the configured database. `target` overrides config (tests pass ':memory:'). */
function open(target) {
  const url = target || config.databaseUrl;
  if (/^postgres(ql)?:\/\//i.test(url || '')) return openPostgres(url);
  return openSqlite(target || config.dbPath);
}

/** True for a unique-constraint violation from either driver. */
const isUniqueViolation = (e) => e && (e.code === '23505' || /UNIQUE constraint failed/i.test(e.message || ''));

module.exports = { open, isUniqueViolation };
