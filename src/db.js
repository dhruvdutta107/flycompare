'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

function open(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookings (
      token          TEXT PRIMARY KEY,
      pnr            TEXT UNIQUE,
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status         TEXT NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired')),
      trip_type      TEXT NOT NULL,
      cabin          TEXT NOT NULL,
      adults         INTEGER NOT NULL,
      children       INTEGER NOT NULL,
      infants        INTEGER NOT NULL,
      legs_json      TEXT NOT NULL,
      passengers_json TEXT,
      contact_email  TEXT COLLATE NOCASE,
      contact_phone  TEXT,
      base_amount    INTEGER NOT NULL,
      taxes          INTEGER NOT NULL,
      discount       INTEGER NOT NULL DEFAULT 0,
      total          INTEGER NOT NULL,
      promo_code     TEXT,
      payment_json   TEXT,
      pay_attempts   INTEGER NOT NULL DEFAULT 0,
      refund_amount  INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at     INTEGER NOT NULL,
      confirmed_at   TEXT,
      cancelled_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_user  ON bookings(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(contact_email);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_token TEXT    NOT NULL REFERENCES bookings(token) ON DELETE CASCADE,
      kind          TEXT    NOT NULL CHECK (kind IN ('checkin','leave','custom')),
      leg_index     INTEGER NOT NULL DEFAULT 0,
      minutes_before INTEGER NOT NULL,
      remind_at     INTEGER NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_booking ON reminders(booking_token);
  `);
  return db;
}

module.exports = { open };
