'use strict';
/**
 * Deterministic demo flight schedule + fare engine.
 *
 * There is no live airline feed in this project, so every (route, date, cabin) produces the same
 * pseudo-random-but-stable set of flights. That means:
 *   - the results page always agrees with the checkout page,
 *   - the server can rebuild a flight from its id and re-price it, so the client can never
 *     tamper with a fare.
 * To use a real supplier (Amadeus, Duffel, Kiwi...) replace `generate()` and `findById()` only.
 */
const airports = require('./airports');
const dates = require('./dates');

const AIRLINES = {
  '6E': { code: '6E', name: 'IndiGo', factor: 0.96, remote: true },
  AI: { code: 'AI', name: 'Air India', factor: 1.12, remote: true },
  QP: { code: 'QP', name: 'Akasa Air', factor: 0.93, remote: false },
  SG: { code: 'SG', name: 'SpiceJet', factor: 0.9, remote: false },
};
const CABINS = { Economy: { letter: 'E', mult: 1 }, 'Premium Economy': { letter: 'P', mult: 1.55 }, Business: { letter: 'B', mult: 2.9 } };
const CABIN_BY_LETTER = Object.fromEntries(Object.entries(CABINS).map(([n, c]) => [c.letter, n]));
const INFANT_FEE = 1100; // flat per infant per leg (taxes only, no seat)
const TAX_SHARE = 0.18;  // share of every fare shown as taxes & fees on the fare breakdown

// ---- tiny seeded PRNG (xmur3 + mulberry32) ----
function seedFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
const durLabel = (m) => `${Math.floor(m / 60)}h ${pad(m % 60)}m`;

function demandFactor(daysAhead) {
  if (daysAhead <= 1) return 1.5; if (daysAhead <= 3) return 1.32; if (daysAhead <= 7) return 1.2;
  if (daysAhead <= 14) return 1.08; if (daysAhead <= 45) return 1; return 0.93;
}
function timeFactor(depMin) {
  const h = depMin / 60;
  if (h < 6 || h >= 22) return 0.88;
  if ((h >= 7 && h < 10) || (h >= 17 && h < 20.5)) return 1.12;
  return 1;
}

function generate(fromCode, toCode, date, cabin = 'Economy', now = new Date(), opts = {}) {
  const from = airports.get(fromCode); const to = airports.get(toCode);
  if (!from || !to || from.code === to.code || !CABINS[cabin]) return [];
  const rand = rng(seedFrom(`${from.code}>${to.code}@${date}`));
  const dist = airports.distanceKm(from, to);
  const blockMin = Math.round((dist / 700) * 60 + 35);
  const today = dates.todayIST(now);
  const daysAhead = dates.diffDays(date, today);
  const dow = dates.weekday(date);
  const weekend = dow === 5 || dow === 0 ? 1.08 : 1;
  const remote = from.remote || to.remote;
  const pool = Object.values(AIRLINES).filter((a) => !remote || a.remote);
  const count = 9 + Math.floor(rand() * 5);
  const usedMinutes = new Set();
  const usedNumbers = new Set();
  const out = [];

  for (let i = 0; i < count; i++) {
    const airline = pool[Math.floor(rand() * pool.length)];
    let depMin; let guard = 0;
    do { depMin = (5 * 60) + Math.floor(rand() * (18.5 * 60) / 5) * 5; guard++; } while (usedMinutes.has(depMin) && guard < 20);
    usedMinutes.add(depMin);
    let num; do { num = 100 + Math.floor(rand() * 899); } while (usedNumbers.has(airline.code + num));
    usedNumbers.add(airline.code + num);

    const oneStop = dist > 650 && rand() < 0.28;
    let via = null; let stopMin = 0;
    if (oneStop) {
      const hubs = airports.HUBS.filter((h) => h !== from.code && h !== to.code);
      via = hubs[Math.floor(rand() * hubs.length)];
      stopMin = 65 + Math.floor(rand() * 6) * 10;
    }
    const detour = oneStop ? Math.round(blockMin * 0.18) : 0;
    const durationMin = Math.round((blockMin + detour + stopMin) / 5) * 5;
    const arrTotal = depMin + durationMin;
    const arrivalDayOffset = Math.floor(arrTotal / 1440);

    let fare = (1100 + dist * 1.7) * airline.factor * timeFactor(depMin) * demandFactor(daysAhead) * weekend * (0.94 + rand() * 0.14);
    if (oneStop) fare *= 0.9;
    fare *= CABINS[cabin].mult;
    const price = Math.max(1499, Math.round(fare / 10) * 10 - 1);
    const seatsLeft = 2 + Math.floor(rand() * 18);

    out.push({
      id: `${airline.code}${num}-${from.code}${to.code}-${date.replace(/-/g, '')}-${CABINS[cabin].letter}`,
      airline: { code: airline.code, name: airline.name },
      number: `${airline.code} ${num}`,
      from: from.code, to: to.code, date, cabin,
      depart: hhmm(depMin), arrive: hhmm(arrTotal), departMin: depMin, arrivalDayOffset,
      durationMin, duration: durLabel(durationMin),
      stops: oneStop ? 1 : 0, via, stopsLabel: oneStop ? `1 Stop · ${via}` : 'Non-stop',
      price, infantPrice: INFANT_FEE, seatsLeft,
      baggage: cabin === 'Business' ? { cabin: '10 kg', checkin: '35 kg' } : cabin === 'Premium Economy' ? { cabin: '7 kg', checkin: '20 kg' } : { cabin: '7 kg', checkin: '15 kg' },
    });
  }
  // Same-day searches hide flights that leave within 2 hours (cannot be booked in practice).
  // (Live tracking passes { includeDeparted: true } to see the whole day's schedule.)
  const cutoff = date === today && !opts.includeDeparted ? dates.nowMinutesIST(now) + 120 : -1;
  return out.filter((f) => f.departMin > cutoff).sort((a, b) => a.departMin - b.departMin);
}

const ID_RE = /^([A-Z0-9]{2})(\d{3})-([A-Z]{3})([A-Z]{3})-(\d{8})-([EPB])$/;
function parseId(id) {
  const m = ID_RE.exec(String(id || ''));
  if (!m) return null;
  const d = m[5];
  return { airline: m[1], from: m[3], to: m[4], date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, cabin: CABIN_BY_LETTER[m[6]] };
}
function findById(id, now = new Date()) {
  const p = parseId(id);
  if (!p) return null;
  return generate(p.from, p.to, p.date, p.cabin, now).find((f) => f.id === id) || null;
}

/** Search filters applied on the server so the API is useful on its own. */
function search({ from, to, date, cabin = 'Economy', direct = false }, now = new Date()) {
  let list = generate(from, to, date, cabin, now);
  if (direct) list = list.filter((f) => f.stops === 0);
  return list;
}

function calendar({ from, to, date, cabin = 'Economy', span = 3 }, now = new Date()) {
  const today = dates.todayIST(now); const out = [];
  for (let n = -span; n <= span; n++) {
    const d = dates.addDays(date, n);
    if (d < today) continue;
    const list = generate(from, to, d, cabin, now);
    out.push({ date: d, from: list.length ? Math.min(...list.map((f) => f.price)) : null });
  }
  return out;
}

/**
 * Price a whole itinerary. `legs` are flight objects. Returns whole-rupee integers.
 * base + taxes === gross; total = gross - discount.
 */
function priceItinerary(legs, { adults, children, infants }) {
  let gross = 0;
  const perLeg = legs.map((f) => {
    const amount = f.price * (adults + children) + f.infantPrice * infants;
    gross += amount;
    return { flightId: f.id, amount };
  });
  const base = Math.round(gross * (1 - TAX_SHARE));
  return { perLeg, gross, base, taxes: gross - base };
}

module.exports = { AIRLINES, CABINS, INFANT_FEE, seedFrom, rng, generate, search, calendar, findById, parseId, priceItinerary };
