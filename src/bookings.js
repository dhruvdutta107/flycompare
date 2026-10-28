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
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function makeService(db) {
  const q = {
    insert: db.prepare(`INSERT INTO bookings (token,user_id,status,trip_type,cabin,adults,children,infants,legs_json,base_amount,taxes,total,expires_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    byToken: db.prepare('SELECT * FROM bookings WHERE token = ?'),
    byPnr: db.prepare('SELECT * FROM bookings WHERE pnr = ?'),
    byUser: db.prepare("SELECT * FROM bookings WHERE user_id = ? AND status IN ('confirmed','cancelled') ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 100"),
    setStatus: db.prepare('UPDATE bookings SET status = ? WHERE token = ?'),
    setPax: db.prepare('UPDATE bookings SET passengers_json=?, contact_email=?, contact_phone=?, user_id=COALESCE(user_id, ?) WHERE token=?'),
    setPricing: db.prepare('UPDATE bookings SET promo_code=?, discount=?, total=? WHERE token=?'),
    attempt: db.prepare('UPDATE bookings SET pay_attempts = pay_attempts + 1 WHERE token = ?'),
    confirm: db.prepare("UPDATE bookings SET status='confirmed', pnr=?, payment_json=?, confirmed_at=datetime('now'), user_id=COALESCE(user_id, ?) WHERE token=?"),
    cancel: db.prepare("UPDATE bookings SET status='cancelled', refund_amount=?, cancelled_at=datetime('now') WHERE token=?"),
    prior: db.prepare("SELECT 1 FROM bookings WHERE status IN ('confirmed','cancelled') AND (contact_email = ? OR (? IS NOT NULL AND user_id = ?)) LIMIT 1"),
    expireOld: db.prepare("UPDATE bookings SET status='expired' WHERE status='held' AND expires_at < ?"),
    remList: db.prepare('SELECT * FROM reminders WHERE booking_token = ? ORDER BY remind_at'),
    remFind: db.prepare('SELECT id FROM reminders WHERE booking_token = ? AND leg_index = ? AND minutes_before = ?'),
    remInsert: db.prepare('INSERT INTO reminders (booking_token, kind, leg_index, minutes_before, remind_at) VALUES (?,?,?,?,?)'),
    remDelete: db.prepare('DELETE FROM reminders WHERE booking_token = ? AND id = ?'),
    remDeleteAll: db.prepare('DELETE FROM reminders WHERE booking_token = ?'),
    remForUser: db.prepare(`SELECT r.* FROM reminders r JOIN bookings b ON b.token = r.booking_token
                            WHERE b.user_id = ? AND b.status = 'confirmed' AND r.remind_at > ? ORDER BY r.remind_at LIMIT 50`),
  };

  const nowMs = () => Date.now();

  function uniquePnr() {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.randomBytes(6);
      const pnr = Array.from(bytes, (b) => PNR_CHARS[b % PNR_CHARS.length]).join('');
      if (!q.byPnr.get(pnr)) return pnr;
    }
    throw new HttpError(500, 'server_error', 'Could not allocate a booking reference.');
  }

  function load(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'not_found', 'Booking not found.');
    let row = q.byToken.get(token);
    if (!row) throw new HttpError(404, 'not_found', 'Booking not found.');
    if (row.status === 'held' && row.expires_at < nowMs()) { q.setStatus.run('expired', token); row = q.byToken.get(token); }
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
      refund: row.refund_amount, createdAt: row.created_at, confirmedAt: row.confirmed_at, cancelledAt: row.cancelled_at,
      holdSecondsLeft: row.status === 'held' ? Math.max(0, Math.round((row.expires_at - nowMs()) / 1000)) : null,
      canCancel: row.status === 'confirmed' && minutesToDeparture(legs[0]) > 0,
    };
  }

  function minutesToDeparture(leg, now = new Date()) {
    if (!leg) return -1;
    return dates.diffDays(leg.date, dates.todayIST(now)) * 1440 + leg.departMin - dates.nowMinutesIST(now);
  }

  function createHold({ tripType, flightIds, adults, children, infants, cabin }, userId) {
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
    q.insert.run(token, userId || null, 'held', tripType, cabin, counts.adults, counts.children, counts.infants, json(legs), price.base, price.taxes, price.gross, nowMs() + config.holdMinutes * 60000);
    return view(load(token));
  }

  function hasPrior(row) {
    return !!q.prior.get(row.contact_email || null, row.user_id ?? null, row.user_id ?? null);
  }

  function reprice(row, code) {
    const legs = parse(row.legs_json, []);
    const gross = row.base_amount + row.taxes;
    if (!code) { q.setPricing.run(null, 0, gross, row.token); return { ok: true }; }
    if (!row.contact_email && !row.user_id && code.toUpperCase() === 'NEWUSER500') return { ok: false, error: 'Enter your passenger and contact details first so we can check this offer.' };
    const res = offers.apply(code, { legs, gross, base: row.base_amount, hasPriorBooking: hasPrior(row) });
    if (!res.ok) return res;
    q.setPricing.run(res.code, res.discount, gross - res.discount, row.token);
    return res;
  }

  function setPassengers(token, body, userId) {
    const row = load(token); requireHeld(row);
    const legs = parse(row.legs_json, []);
    const data = validate.passengers(body, { adults: row.adults, children: row.children, infants: row.infants }, legs[legs.length - 1].date);
    q.setPax.run(json(data.passengers), data.email, data.phone, userId || null, token);
    const fresh = q.byToken.get(token);
    if (fresh.promo_code) reprice(fresh, fresh.promo_code).ok || reprice(q.byToken.get(token), null);
    return view(q.byToken.get(token));
  }

  function setPromo(token, code) {
    const row = load(token); requireHeld(row);
    if (!code) { reprice(row, null); return { ...view(q.byToken.get(token)), promoMessage: 'Promo code removed.' }; }
    const res = reprice(row, String(code));
    if (!res.ok) throw new ValidationError({ promo: res.error }, res.error);
    return { ...view(q.byToken.get(token)), promoMessage: `${res.code} applied - you save Rs ${res.discount.toLocaleString('en-IN')}.` };
  }

  function pay(token, body, userId) {
    const row = load(token);
    if (row.status === 'confirmed') return view(row); // idempotent: double-click / retry after success
    requireHeld(row);
    if (!row.passengers_json) throw new HttpError(409, 'passengers_missing', 'Add passenger details before paying.');
    if (row.pay_attempts >= MAX_PAY_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many failed payment attempts. Please start a new booking.');
    const instrument = payments.validate(String(body.method || ''), body);
    if (row.promo_code) { const r = reprice(row, row.promo_code); if (!r.ok) throw new HttpError(409, 'promo_invalid', r.error); }
    const current = q.byToken.get(token);
    const result = payments.charge(instrument, current.total);
    if (!result.ok) {
      q.attempt.run(token);
      throw new HttpError(402, 'payment_failed', result.error);
    }
    q.confirm.run(uniquePnr(), json(result.record), userId || null, token);
    return view(q.byToken.get(token));
  }

  function cancel(token, now = new Date()) {
    const row = load(token);
    if (row.status === 'cancelled') return view(row);
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_cancellable', 'Only confirmed bookings can be cancelled.');
    const legs = parse(row.legs_json, []);
    const mins = minutesToDeparture(legs[0], now);
    if (mins <= 0) throw new HttpError(409, 'departed', 'This trip has already departed and can no longer be cancelled.');
    const fee = Math.min(row.total, CANCEL_FEE_PER_PAX * (row.adults + row.children) * legs.length);
    const refund = mins > 24 * 60 ? row.total - fee : Math.max(0, Math.floor(row.total / 2) - fee);
    q.cancel.run(refund, token);
    q.remDeleteAll.run(token);
    return view(q.byToken.get(token));
  }

  function lookup(pnr, email) {
    const row = q.byPnr.get(String(pnr || '').trim().toUpperCase());
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

  function listReminders(token) {
    const row = load(token); const legs = parse(row.legs_json, []);
    return q.remList.all(token).map((r) => reminderView(r, row, legs));
  }

  function addReminder(token, body = {}) {
    const row = load(token);
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
    const existing = q.remFind.get(token, legIndex, minutes);
    if (!existing) {
      if (q.remList.all(token).length >= 8) throw new HttpError(409, 'too_many', 'You can set up to 8 reminders per booking.');
      q.remInsert.run(token, kind, legIndex, minutes, at);
    }
    return listReminders(token);
  }

  function deleteReminder(token, id) {
    load(token); q.remDelete.run(token, Number(id));
    return listReminders(token);
  }

  function remindersForUser(userId) {
    const out = [];
    const cache = new Map();
    for (const r of q.remForUser.all(userId, nowMs() - 3600000)) {
      if (!cache.has(r.booking_token)) { const row = q.byToken.get(r.booking_token); cache.set(r.booking_token, [row, parse(row.legs_json, [])]); }
      const [row, legs] = cache.get(r.booking_token);
      out.push(reminderView(r, row, legs));
    }
    return out;
  }

  /** iCalendar file: one event per flight, with an alarm for each reminder (or sensible defaults). */
  function calendar(token) {
    const row = load(token);
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', 'Only confirmed bookings can be added to a calendar.');
    const legs = parse(row.legs_json, []); const rems = q.remList.all(token);
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

  const listForUser = (userId) => q.byUser.all(userId).map(view);
  const sweep = () => q.expireOld.run(nowMs());

  return { createHold, get: (t) => view(load(t)), setPassengers, setPromo, pay, cancel, lookup, listForUser, sweep, minutesToDeparture, listReminders, addReminder, deleteReminder, remindersForUser, calendar };
}

module.exports = { makeService, CANCEL_FEE_PER_PAX };
