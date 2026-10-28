'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const dates = require('./dates');
const flights = require('./flights');
const offers = require('./offers');
const payments = require('./payments');
const { newToken } = require('./security');
const { HttpError, ValidationError } = require('./validate');
const validate = require('./validate');

const PNR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CANCEL_FEE_PER_PAX = 250;
const MAX_PAY_ATTEMPTS = 6;

const json = (v) => JSON.stringify(v);
// JSON columns are jsonb objects on PostgreSQL and text on SQLite
const parse = (s, d = null) => { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : d; } catch { return d; } };
// timestamps are Date objects on PostgreSQL and ISO / 'YYYY-MM-DD HH:MM:SS' (UTC) text on SQLite
const iso = (v) => { if (!v) return null; if (v instanceof Date) return v.toISOString(); const t = String(v); return /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? new Date(t).toISOString() : new Date(t.replace(' ', 'T') + 'Z').toISOString(); };

function makeService(db) {
  // SQL is written in PostgreSQL style ($1, $2...) and also runs on the SQLite driver (see src/db.js).
  const S = (sql) => ({ get: (...p) => db.get(sql, p), all: (...p) => db.all(sql, p), run: (...p) => db.run(sql, p) });
  const q = {
    insert: S(`INSERT INTO bookings (token,user_id,status,trip_type,cabin,adults,children,infants,legs_json,base_amount,taxes,total,expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`),
    byToken: S('SELECT * FROM bookings WHERE token = $1'),
    byPnr: S('SELECT * FROM bookings WHERE pnr = $1'),
    byUser: S("SELECT * FROM bookings WHERE user_id = $1 AND status IN ('confirmed','cancelled') ORDER BY created_at DESC, token DESC LIMIT 100"),
    expireOne: S("UPDATE bookings SET status = 'expired' WHERE token = $1 AND status = 'held'"),
    setPax: S('UPDATE bookings SET passengers_json=$1::jsonb, contact_email=$2, contact_phone=$3, user_id=COALESCE(user_id, $4) WHERE token=$5'),
    setPricing: S('UPDATE bookings SET promo_code=$1, discount=$2, total=$3 WHERE token=$4'),
    attempt: S('UPDATE bookings SET pay_attempts = pay_attempts + 1 WHERE token = $1'),
    // only a still-held booking can be confirmed, so two simultaneous "Pay" clicks cannot both confirm it
    confirm: S("UPDATE bookings SET status='confirmed', pnr=$1, payment_json=$2::jsonb, confirmed_at=$3, user_id=COALESCE(user_id, $4) WHERE token=$5 AND status='held' RETURNING token"),
    cancel: S("UPDATE bookings SET status='cancelled', refund_amount=$1, cancelled_at=$2 WHERE token=$3 AND status='confirmed'"),
    prior: S("SELECT 1 AS x FROM bookings WHERE status IN ('confirmed','cancelled') AND (contact_email = $1 OR ($2::bigint IS NOT NULL AND user_id = $2)) LIMIT 1"),
    expireOld: S("UPDATE bookings SET status='expired' WHERE status='held' AND expires_at < $1"),
    remList: S('SELECT * FROM reminders WHERE booking_token = $1 ORDER BY remind_at'),
    remFind: S('SELECT id FROM reminders WHERE booking_token = $1 AND leg_index = $2 AND minutes_before = $3'),
    remInsert: S('INSERT INTO reminders (booking_token, kind, leg_index, minutes_before, remind_at) VALUES ($1,$2,$3,$4,$5)'),
    remDelete: S('DELETE FROM reminders WHERE booking_token = $1 AND id = $2'),
    remDeleteAll: S('DELETE FROM reminders WHERE booking_token = $1'),
    remForUser: S(`SELECT r.* FROM reminders r JOIN bookings b ON b.token = r.booking_token
                   WHERE b.user_id = $1 AND b.status = 'confirmed' AND r.remind_at > $2 ORDER BY r.remind_at LIMIT 50`),
  };

  const nowMs = () => Date.now();

  async function uniquePnr() {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.randomBytes(6);
      const pnr = Array.from(bytes, (b) => PNR_CHARS[b % PNR_CHARS.length]).join('');
      if (!(await q.byPnr.get(pnr))) return pnr;
    }
    throw new HttpError(500, 'server_error', 'Could not allocate a booking reference.');
  }

  async function load(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'not_found', 'Booking not found.');
    let row = await q.byToken.get(token);
    if (!row) throw new HttpError(404, 'not_found', 'Booking not found.');
    if (row.status === 'held' && row.expires_at < nowMs()) { await q.expireOne.run(token); row = await q.byToken.get(token); }
    return row;
  }
  const requireHeld = (row) => {
    if (row.status === 'expired') throw new HttpError(410, 'expired', 'Your fare hold expired. Please search again to get the latest fare.');
    if (row.status !== 'held') throw new HttpError(409, 'not_editable', 'This booking is already complete.');
  };

  function view(row) {
    const legs = parse(row.legs_json, []);
    const payment = parse(row.payment_json);
    return {
      token: row.token, pnr: row.pnr, status: row.status, tripType: row.trip_type, cabin: row.cabin,
      counts: { adults: row.adults, children: row.children, infants: row.infants },
      legs,
      passengers: parse(row.passengers_json, []),
      contact: row.contact_email ? { email: row.contact_email, phone: row.contact_phone } : null,
      pricing: { base: row.base_amount, taxes: row.taxes, gross: row.base_amount + row.taxes, discount: row.discount, total: row.total, promoCode: row.promo_code },
      payment: payment && { method: payment.method, brand: payment.brand, last4: payment.last4, upi: payment.upi, bank: payment.bank, txnId: payment.txnId, paidAt: payment.paidAt },
      refund: row.refund_amount, createdAt: iso(row.created_at), confirmedAt: iso(row.confirmed_at), cancelledAt: iso(row.cancelled_at),
      holdSecondsLeft: row.status === 'held' ? Math.max(0, Math.round((row.expires_at - nowMs()) / 1000)) : null,
      canCancel: row.status === 'confirmed' && minutesToDeparture(legs[0]) > 0,
    };
  }

  function minutesToDeparture(leg, now = new Date()) {
    if (!leg) return -1;
    return dates.diffDays(leg.date, dates.todayIST(now)) * 1440 + leg.departMin - dates.nowMinutesIST(now);
  }

  async function createHold({ tripType, flightIds, adults, children, infants, cabin }, userId) {
    const counts = { adults: Number(adults), children: Number(children || 0), infants: Number(infants || 0) };
    const f = {};
    if (!Number.isInteger(counts.adults) || counts.adults < 1 || counts.adults > 9) f.adults = 'Between 1 and 9 adults.';
    if (!Number.isInteger(counts.children) || counts.children < 0 || counts.children > 6) f.children = 'Between 0 and 6 children.';
    if (!Number.isInteger(counts.infants) || counts.infants < 0 || counts.infants > counts.adults) f.infants = 'Each infant needs an adult (max 1 infant per adult).';
    if (!f.adults && !f.children && counts.adults + counts.children > 9) f.adults = 'You can book up to 9 seats at once.';
    if (!['oneway', 'return', 'multicity'].includes(tripType)) f.tripType = 'Unknown trip type.';
    if (!flights.CABINS[cabin]) f.cabin = 'Unknown cabin class.';
    if (!Array.isArray(flightIds) || flightIds.length < 1 || flightIds.length > 4) f.flights = 'Choose between 1 and 4 flights.';
    if (Object.keys(f).length) throw new ValidationError(f);

    const legs = flightIds.map((id) => flights.findById(id));
    if (legs.some((l) => !l)) throw new HttpError(409, 'flight_unavailable', 'One of the selected flights is no longer available. Please search again.');
    if (new Set(flightIds).size !== flightIds.length) throw new HttpError(422, 'validation', 'The same flight was selected twice.');
    if (legs.some((l) => l.cabin !== cabin)) throw new HttpError(422, 'validation', 'All flights must be in the same cabin class.');
    if (tripType === 'oneway' && legs.length !== 1) throw new HttpError(422, 'validation', 'A one-way trip has exactly one flight.');
    if (tripType === 'return' && (legs.length !== 2 || legs[1].from !== legs[0].to || legs[1].to !== legs[0].from)) throw new HttpError(422, 'validation', 'A return trip needs an outbound flight and the matching return flight.');
    if (tripType === 'multicity' && legs.length < 2) throw new HttpError(422, 'validation', 'A multi-city trip needs at least two flights.');
    for (let i = 1; i < legs.length; i++) {
      const prev = legs[i - 1]; const cur = legs[i];
      const prevArrival = dates.diffDays(prev.date, '2000-01-01') * 1440 + prev.departMin + prev.durationMin;
      const curDep = dates.diffDays(cur.date, '2000-01-01') * 1440 + cur.departMin;
      if (curDep <= prevArrival) throw new HttpError(422, 'validation', 'Each flight must depart after the previous one lands.');
    }
    const price = flights.priceItinerary(legs, counts);
    const token = newToken(18);
    await q.insert.run(token, userId || null, 'held', tripType, cabin, counts.adults, counts.children, counts.infants, json(legs), price.base, price.taxes, price.gross, nowMs() + config.holdMinutes * 60000);
    return view(await load(token));
  }

  async function hasPrior(row) {
    return !!await q.prior.get(row.contact_email || null, row.user_id ?? null);
  }

  async function reprice(row, code) {
    const legs = parse(row.legs_json, []);
    const gross = row.base_amount + row.taxes;
    if (!code) { await q.setPricing.run(null, 0, gross, row.token); return { ok: true }; }
    if (!row.contact_email && !row.user_id && code.toUpperCase() === 'NEWUSER500') return { ok: false, error: 'Enter your passenger and contact details first so we can check this offer.' };
    const res = offers.apply(code, { legs, gross, base: row.base_amount, hasPriorBooking: await hasPrior(row) });
    if (!res.ok) return res;
    await q.setPricing.run(res.code, res.discount, gross - res.discount, row.token);
    return res;
  }

  async function setPassengers(token, body, userId) {
    const row = await load(token); requireHeld(row);
    const legs = parse(row.legs_json, []);
    const data = validate.passengers(body, { adults: row.adults, children: row.children, infants: row.infants }, legs[legs.length - 1].date);
    await q.setPax.run(json(data.passengers), data.email, data.phone, userId || null, token);
    const fresh = await q.byToken.get(token);
    if (fresh.promo_code && !(await reprice(fresh, fresh.promo_code)).ok) await reprice(await q.byToken.get(token), null);
    return view(await q.byToken.get(token));
  }

  async function setPromo(token, code) {
    const row = await load(token); requireHeld(row);
    if (!code) { await reprice(row, null); return { ...view(await q.byToken.get(token)), promoMessage: 'Promo code removed.' }; }
    const res = await reprice(row, String(code));
    if (!res.ok) throw new ValidationError({ promo: res.error }, res.error);
    return { ...view(await q.byToken.get(token)), promoMessage: `${res.code} applied - you save Rs ${res.discount.toLocaleString('en-IN')}.` };
  }

  async function pay(token, body, userId) {
    const row = await load(token);
    if (row.status === 'confirmed') return view(row); // idempotent: double-click / retry after success
    requireHeld(row);
    if (!row.passengers_json) throw new HttpError(409, 'passengers_missing', 'Add passenger details before paying.');
    if (row.pay_attempts >= MAX_PAY_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many failed payment attempts. Please start a new booking.');
    const instrument = payments.validate(String(body.method || ''), body);
    if (row.promo_code) { const r = await reprice(row, row.promo_code); if (!r.ok) throw new HttpError(409, 'promo_invalid', r.error); }
    const current = await q.byToken.get(token);
    const result = payments.charge(instrument, current.total);
    if (!result.ok) {
      await q.attempt.run(token);
      throw new HttpError(402, 'payment_failed', result.error);
    }
    await q.confirm.run(await uniquePnr(), json(result.record), new Date().toISOString(), userId || null, token);
    return view(await q.byToken.get(token));
  }

  async function cancel(token, now = new Date()) {
    const row = await load(token);
    if (row.status === 'cancelled') return view(row);
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_cancellable', 'Only confirmed bookings can be cancelled.');
    const legs = parse(row.legs_json, []);
    const mins = minutesToDeparture(legs[0], now);
    if (mins <= 0) throw new HttpError(409, 'departed', 'This trip has already departed and can no longer be cancelled.');
    const fee = Math.min(row.total, CANCEL_FEE_PER_PAX * (row.adults + row.children) * legs.length);
    const refund = mins > 24 * 60 ? row.total - fee : Math.max(0, Math.floor(row.total / 2) - fee);
    await q.cancel.run(refund, now.toISOString(), token);
    await q.remDeleteAll.run(token);
    return view(await q.byToken.get(token));
  }

  async function lookup(pnr, email) {
    const row = await q.byPnr.get(String(pnr || '').trim().toUpperCase());
    // Same response whether the PNR or the e-mail is wrong, so PNRs cannot be probed.
    if (!row || !row.contact_email || row.contact_email.toLowerCase() !== String(email || '').trim().toLowerCase()) throw new HttpError(404, 'not_found', 'We could not find a booking with that reference and e-mail.');
    return view(row);
  }

  // ---------- trip reminders ----------
  const departureEpoch = (leg) => Date.parse(`${leg.date}T00:00:00+05:30`) + leg.departMin * 60000;
  const REMINDER_PRESETS = { checkin: 1440, leave: 180 };
  const CUSTOM_MINUTES = [30, 60, 120, 180, 360, 720, 1440, 2880];
  const fmtLead = (m) => (m % 1440 === 0 ? `${m / 1440} day${m > 1440 ? 's' : ''}` : m >= 60 ? `${m / 60} h` : `${m} min`);

  function reminderView(r, row, legs) {
    const leg = legs[r.leg_index] || legs[0];
    const route = `${leg.from}→${leg.to}`;
    const text = {
      checkin: [`Web check-in is open for ${leg.number}`, `${route} departs ${leg.date} at ${leg.depart} IST. Check in online and pick your seat.`],
      leave: [`Time to leave for the airport`, `${leg.number} ${route} departs at ${leg.depart} IST - aim to be at ${leg.from} 2 hours before.`],
      custom: [`${leg.number} departs in ${fmtLead(r.minutes_before)}`, `${route} on ${leg.date} at ${leg.depart} IST. PNR ${row.pnr}.`],
    }[r.kind];
    return { id: r.id, kind: r.kind, legIndex: r.leg_index, minutesBefore: r.minutes_before, remindAt: r.remind_at, title: text[0], body: text[1], pnr: row.pnr, token: row.token, flight: leg.number };
  }

  async function listReminders(token) {
    const row = await load(token); const legs = parse(row.legs_json, []);
    return (await q.remList.all(token)).map((r) => reminderView(r, row, legs));
  }

  async function addReminder(token, body = {}) {
    const row = await load(token);
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', 'Reminders can only be set on confirmed bookings.');
    const legs = parse(row.legs_json, []);
    const kind = String(body.kind || '');
    const legIndex = body.legIndex === undefined ? 0 : Number(body.legIndex);
    const f = {};
    if (!['checkin', 'leave', 'custom'].includes(kind)) f.kind = 'Choose a reminder type.';
    if (!Number.isInteger(legIndex) || legIndex < 0 || legIndex >= legs.length) f.legIndex = 'Choose one of the flights in this booking.';
    const minutes = kind === 'custom' ? Number(body.minutesBefore) : REMINDER_PRESETS[kind];
    if (kind === 'custom' && !CUSTOM_MINUTES.includes(minutes)) f.minutesBefore = 'Choose how long before departure.';
    if (Object.keys(f).length) throw new ValidationError(f);
    const at = departureEpoch(legs[legIndex]) - minutes * 60000;
    if (at <= nowMs()) throw new HttpError(409, 'too_late', `It is already less than ${fmtLead(minutes)} before this flight, so that reminder cannot be set.`);
    const existing = await q.remFind.get(token, legIndex, minutes);
    if (!existing) {
      if ((await q.remList.all(token)).length >= 8) throw new HttpError(409, 'too_many', 'You can set up to 8 reminders per booking.');
      await q.remInsert.run(token, kind, legIndex, minutes, at);
    }
    return listReminders(token);
  }

  async function deleteReminder(token, id) {
    await load(token); await q.remDelete.run(token, Number(id) || 0);
    return listReminders(token);
  }

  async function remindersForUser(userId) {
    const out = [];
    const cache = new Map();
    for (const r of await q.remForUser.all(userId, nowMs() - 3600000)) {
      if (!cache.has(r.booking_token)) { const row = await q.byToken.get(r.booking_token); cache.set(r.booking_token, [row, parse(row.legs_json, [])]); }
      const [row, legs] = cache.get(r.booking_token);
      out.push(reminderView(r, row, legs));
    }
    return out;
  }

  /** iCalendar file: one event per flight, with an alarm for each reminder (or sensible defaults). */
  async function calendar(token) {
    const row = await load(token);
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', 'Only confirmed bookings can be added to a calendar.');
    const legs = parse(row.legs_json, []); const rems = await q.remList.all(token);
    const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FlyCompare//Trip//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    legs.forEach((l, i) => {
      const start = departureEpoch(l);
      const alarms = rems.filter((r) => r.leg_index === i).map((r) => r.minutes_before);
      lines.push('BEGIN:VEVENT', `UID:${row.pnr}-${i}@flycompare`, `DTSTAMP:${stamp(nowMs())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + l.durationMin * 60000)}`,
        `SUMMARY:${esc(`Flight ${l.number} ${l.from} → ${l.to}`)}`, `LOCATION:${esc(`${l.from} airport`)}`,
        `DESCRIPTION:${esc(`${l.airline.name} ${l.number}, ${l.stopsLabel}. Departs ${l.depart}, arrives ${l.arrive}${l.arrivalDayOffset ? ' (+1 day)' : ''} IST. PNR ${row.pnr}. Baggage: cabin ${l.baggage.cabin}, check-in ${l.baggage.checkin}.`)}`);
      for (const m of alarms.length ? alarms : [1440, 180]) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${m}M`, `DESCRIPTION:${esc(`${l.number} departs in ${fmtLead(m)}`)}`, 'END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return { filename: `FlyCompare-${row.pnr}.ics`, body: lines.join('\r\n') + '\r\n' };
  }

  const listForUser = async (userId) => (await q.byUser.all(userId)).map(view);
  const sweep = () => q.expireOld.run(nowMs());

  return { createHold, get: async (t) => view(await load(t)), setPassengers, setPromo, pay, cancel, lookup, listForUser, sweep, minutesToDeparture, listReminders, addReminder, deleteReminder, remindersForUser, calendar };
}

module.exports = { makeService, CANCEL_FEE_PER_PAX };
