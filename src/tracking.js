'use strict';
/**
 * SIMULATED live flight status.
 *
 * There is no live ADS-B / airline feed in this project, so status is derived from the same deterministic schedule
 * the search engine uses (src/flights.js) plus a seeded delay per flight. Given the current time it works out the
 * phase (check-in, boarding, airborne, landed...), the aircraft position along the great-circle route, altitude,
 * speed and arrival estimate. Every client polling the same flight sees the same thing, and the plane really moves.
 *
 * To go live, replace `status()` with a call to AviationStack / FlightAware AeroAPI / OpenSky and keep the same
 * response shape - the front-end only reads the fields returned here.
 */
const airports = require('./airports');
const dates = require('./dates');
const flights = require('./flights');

const MIN = 60_000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const fmtIST = new Intl.DateTimeFormat('en-GB', { timeZone: dates.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (ms) => fmtIST.format(new Date(ms));
const istMidnight = (iso) => Date.parse(`${iso}T00:00:00+05:30`);

// Terminal allocation (indicative, simplified).
const TERMINALS = {
  DEL: { AI: 'T3', _: 'T1' }, BOM: { AI: 'T2', '6E': 'T2', _: 'T1' }, BLR: { AI: 'T2', _: 'T1' },
  HYD: { _: 'T1' }, MAA: { _: 'T1' }, CCU: { _: 'T1' }, GOI: { _: 'T1' }, PNQ: { _: 'T1' }, AMD: { _: 'T1' },
};
const terminalFor = (code, airline) => { const t = TERMINALS[code]; return t ? (t[airline] || t._) : 'T1'; };

function centralAngle(a, b) {
  const p1 = rad(a.lat); const p2 = rad(b.lat); const dp = p2 - p1; const dl = rad(b.lon - a.lon);
  return 2 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
}
/** Point a fraction `f` of the way along the great circle from a to b. */
function interpolate(a, b, f) {
  const d = centralAngle(a, b);
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d); const B = Math.sin(f * d) / Math.sin(d);
  const p1 = rad(a.lat); const l1 = rad(a.lon); const p2 = rad(b.lat); const l2 = rad(b.lon);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}
function bearing(a, b) {
  const p1 = rad(a.lat); const p2 = rad(b.lat); const dl = rad(b.lon - a.lon);
  const t = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return (deg(t) + 360) % 360;
}

/** Finds a flight by id regardless of whether it has already departed today. */
function findAny(id, now = new Date()) {
  const p = flights.parseId(id);
  if (!p || !p.cabin) return null;
  return flights.generate(p.from, p.to, p.date, p.cabin, now, { includeDeparted: true }).find((f) => f.id === id) || null;
}

// A stable per-flight delay / gate / belt, independent of the cabin the flight was booked in.
function operational(f) {
  const r = flights.rng(flights.seedFrom(`${f.number}|${f.from}${f.to}|${f.date}|ops`));
  const roll = r();
  let delay = Math.round(r() * 5);
  if (roll > 0.62) delay = 10 + Math.round(r() * 30);
  if (roll > 0.93) delay = 45 + Math.round(r() * 75);
  delay = Math.round(delay / 5) * 5;
  const gate = `${'ABCD'[Math.floor(r() * 4)]}${1 + Math.floor(r() * 32)}`;
  const belt = 1 + Math.floor(r() * 12);
  const cruise = 33000 + Math.floor(r() * 5) * 1000;
  const recovery = delay >= 20 ? Math.round(r() * 8) : 0; // airborne catch-up
  return { delay, gate, belt, cruise, recovery };
}

function segmentsOf(f) {
  const from = airports.get(f.from); const to = airports.get(f.to);
  if (!f.via) return { points: [from, to], segs: [{ a: from, b: to, flyMin: f.durationMin }], stopMin: 0 };
  const via = airports.get(f.via);
  const d1 = airports.distanceKm(from, via); const d2 = airports.distanceKm(via, to);
  // reconstruct the stop time used by the schedule engine: duration = fly + stop
  const directBlock = Math.round((airports.distanceKm(from, to) / 700) * 60 + 35);
  const stopMin = Math.max(45, f.durationMin - Math.round(directBlock * 1.18));
  const fly = f.durationMin - stopMin;
  const fly1 = Math.round(fly * (d1 / (d1 + d2)));
  return { points: [from, via, to], segs: [{ a: from, b: via, flyMin: fly1 }, { a: via, b: to, flyMin: fly - fly1 }], stopMin };
}

const PHASES = {
  scheduled: 'Scheduled', checkin: 'Check-in open', boarding: 'Boarding', gate_closed: 'Gate closed',
  departed: 'Departed', en_route: 'In the air', at_stop: 'At stopover', landed: 'Landed', arrived: 'Arrived',
};

/** Live status for one flight. Returns null when the id is unknown. */
function status(id, now = new Date()) {
  const f = findAny(id, now);
  if (!f) return null;
  const t = now.getTime();
  const ops = operational(f);
  const { points, segs, stopMin } = segmentsOf(f);
  const schedDep = istMidnight(f.date) + f.departMin * MIN;
  const schedArr = schedDep + f.durationMin * MIN;
  const estDep = schedDep + ops.delay * MIN;
  const estArr = schedArr + Math.max(0, ops.delay - ops.recovery) * MIN;
  const span = estArr - estDep;

  let phase; let progress = 0; let position = null; let segIndex = 0;
  if (t < estDep - 24 * 60 * MIN) phase = 'scheduled';
  else if (t < estDep - 50 * MIN) phase = 'checkin';
  else if (t < estDep - 15 * MIN) phase = 'boarding';
  else if (t < estDep) phase = 'gate_closed';
  else if (t < estArr) {
    phase = t < estDep + 8 * MIN ? 'departed' : 'en_route';
    // walk the segments (time is stretched/squeezed to the estimated block time)
    const scale = span / (f.durationMin * MIN);
    let cursor = estDep;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]; const segEnd = cursor + seg.flyMin * MIN * scale;
      if (t < segEnd) {
        const sf = (t - cursor) / (segEnd - cursor);
        const p = interpolate(seg.a, seg.b, sf);
        const climb = Math.min(1, sf / 0.14); const descend = Math.min(1, (1 - sf) / 0.17);
        const altitudeFt = Math.round((ops.cruise * Math.min(climb, descend)) / 100) * 100;
        const km = airports.distanceKm(seg.a, seg.b);
        const cruiseKts = (km / ((seg.flyMin * scale) / 60)) / 1.852 * 1.12;
        const speedKts = Math.round(Math.max(150, Math.min(480, cruiseKts) * (0.55 + 0.45 * Math.min(climb, descend))));
        position = { lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), altitudeFt, speedKts, heading: Math.round(bearing(p, seg.b)) };
        segIndex = i; break;
      }
      cursor = segEnd;
      if (i < segs.length - 1) {
        const stopEnd = cursor + stopMin * MIN * scale;
        if (t < stopEnd) { phase = 'at_stop'; position = { lat: seg.b.lat, lon: seg.b.lon, altitudeFt: 0, speedKts: 0, heading: Math.round(bearing(seg.b, segs[i + 1].b)) }; segIndex = i + 1; break; }
        cursor = stopEnd;
      }
    }
    progress = (t - estDep) / span;
  } else {
    phase = t < estArr + 15 * MIN ? 'landed' : 'arrived';
    progress = 1;
    const last = points[points.length - 1];
    position = { lat: last.lat, lon: last.lon, altitudeFt: 0, speedKts: 0, heading: 0 };
  }

  const pub = (a) => ({ code: a.code, city: a.city, lat: a.lat, lon: a.lon });
  const late = ops.delay >= 15;
  let label = PHASES[phase];
  if (late && ['scheduled', 'checkin', 'boarding', 'gate_closed'].includes(phase)) label += ` · Delayed ${ops.delay} min`;
  const arrDelay = Math.round((estArr - schedArr) / MIN);
  return {
    simulated: true,
    id: f.id, number: f.number, airline: f.airline, date: f.date, stopsLabel: f.stopsLabel, duration: f.duration,
    from: { ...pub(airports.get(f.from)), terminal: terminalFor(f.from, f.airline.code), gate: ops.gate },
    to: { ...pub(airports.get(f.to)), terminal: terminalFor(f.to, f.airline.code), belt: ['landed', 'arrived'].includes(phase) ? ops.belt : null },
    route: points.map(pub), segment: segIndex,
    phase, phaseLabel: label, delayMin: ops.delay, arrivalDelayMin: arrDelay,
    onTime: arrDelay < 15,
    times: {
      scheduledDeparture: hhmm(schedDep), estimatedDeparture: hhmm(estDep),
      scheduledArrival: hhmm(schedArr), estimatedArrival: hhmm(estArr),
      departureEpoch: estDep, arrivalEpoch: estArr,
    },
    progress: +Math.max(0, Math.min(1, progress)).toFixed(4),
    remainingMin: t < estArr ? Math.round((estArr - Math.max(t, estDep)) / MIN) : 0,
    minutesToDeparture: Math.round((estDep - t) / MIN),
    position,
    updatedAt: new Date(t).toISOString(),
  };
}

// ---------- look-ups by flight number (index the whole day's schedule once per date) ----------
const dayIndex = new Map();
function indexFor(date, now) {
  if (dayIndex.has(date)) return dayIndex.get(date);
  const out = [];
  for (const a of airports.AIRPORTS) {
    for (const b of airports.AIRPORTS) {
      if (a.code === b.code) continue;
      for (const f of flights.generate(a.code, b.code, date, 'Economy', now, { includeDeparted: true })) out.push(f);
    }
  }
  if (dayIndex.size > 4) dayIndex.delete(dayIndex.keys().next().value);
  dayIndex.set(date, out);
  return out;
}

function findByNumber(number, date, now = new Date()) {
  const m = /^\s*(6E|AI|QP|SG)\s*-?\s*(\d{3})\s*$/i.exec(String(number || ''));
  if (!m || !dates.isISODate(date)) return [];
  const want = `${m[1].toUpperCase()} ${m[2]}`;
  return indexFor(date, now).filter((f) => f.number === want).map((f) => summary(f, now));
}

function summary(f, now) {
  const s = status(f.id, now);
  return { id: f.id, number: f.number, airline: f.airline, from: s.from.code, fromCity: s.from.city, to: s.to.code, toCity: s.to.city, depart: s.times.estimatedDeparture, arrive: s.times.estimatedArrival, phase: s.phase, phaseLabel: s.phaseLabel, progress: s.progress, delayMin: s.delayMin };
}

/** A handful of flights that are airborne right now on busy routes - for the "in the air now" board. */
function liveNow(now = new Date(), limit = 10) {
  const busy = ['BOM', 'DEL', 'BLR', 'HYD', 'MAA', 'CCU', 'GOI', 'PNQ', 'AMD', 'COK'];
  const today = dates.todayIST(now); const yesterday = dates.addDays(today, -1);
  const out = [];
  for (const date of [yesterday, today]) {
    for (const f of indexFor(date, now)) {
      if (!busy.includes(f.from) || !busy.includes(f.to)) continue;
      const s = summary(f, now);
      if (s.phase === 'en_route' || s.phase === 'departed') out.push(s);
    }
  }
  // spread across routes: keep at most one per route, most recently departed first
  const seen = new Set();
  const uniq = out.sort((a, b) => a.progress - b.progress).filter((s) => { const k = s.from + s.to; if (seen.has(k)) return false; seen.add(k); return true; });
  if (uniq.length <= limit) return uniq;
  const step = uniq.length / limit; // sample evenly so the board shows planes at every stage of their journey
  return Array.from({ length: limit }, (_, i) => uniq[Math.floor(i * step)]);
}

module.exports = { status, findAny, findByNumber, liveNow, interpolate, bearing, PHASES };
