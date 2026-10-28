'use strict';
/**
 * Ground transport from the arrival airport: app cabs, prepaid taxis and public transport.
 *
 * Public-transport services are INDICATIVE (well-known airport links with typical hours/frequency); cab fares use a
 * simple distance x per-km model, and "live" cab availability is simulated (it changes every few minutes and with
 * the time of day). Swap `cabsNear()` for the Uber/Ola partner APIs to make it real.
 */
const airports = require('./airports');
const flights = require('./flights');

// City-centre / main landmark used as the default drop-off.
const CENTRES = {
  BOM: ['CSMT / Fort', 18.9400, 72.8353], DEL: ['Connaught Place', 28.6315, 77.2167], BLR: ['MG Road', 12.9756, 77.6050],
  HYD: ['Abids / Koti', 17.3850, 78.4867], MAA: ['Chennai Central', 13.0827, 80.2750], CCU: ['Esplanade', 22.5646, 88.3510],
  GOI: ['Panaji', 15.4909, 73.8278], AMD: ['Lal Darwaja', 23.0225, 72.5714], PNQ: ['Pune Station', 18.5289, 73.8744],
  COK: ['Ernakulam', 9.9816, 76.2999], JAI: ['Jaipur Junction', 26.9196, 75.7878], LKO: ['Hazratganj', 26.8500, 80.9462],
  IXL: ['Leh Main Bazaar', 34.1642, 77.5848], GAU: ['Paltan Bazaar', 26.1820, 91.7510], PAT: ['Patna Junction', 25.6022, 85.1376],
  IXC: ['Sector 17', 30.7398, 76.7827], TRV: ['East Fort', 8.4833, 76.9476], NAG: ['Sitabuldi', 21.1458, 79.0882],
  IDR: ['Rajwada', 22.7186, 75.8551], BBI: ['Master Canteen', 20.2700, 85.8400], SXR: ['Lal Chowk', 34.0700, 74.8090],
  VNS: ['Godowlia', 25.3090, 83.0070], IXB: ['Siliguri', 26.7271, 88.3953], ATQ: ['Golden Temple', 31.6200, 74.8765],
  IXZ: ['Aberdeen Bazaar', 11.6670, 92.7360], CJB: ['Gandhipuram', 11.0168, 76.9558], VTZ: ['RTC Complex', 17.7231, 83.3013],
  UDR: ['City Palace', 24.5764, 73.6835], DED: ['Clock Tower', 30.3244, 78.0418], RPR: ['Jaistambh Chowk', 21.2380, 81.6337],
  IXR: ['Firayalal Chowk', 23.3700, 85.3250], BHO: ['New Market', 23.2332, 77.4005],
};

// Indicative public transport. start/end are "HH:MM" (end < start means past midnight; '24h' = round the clock).
const TRANSIT = {
  DEL: [
    { mode: 'metro', name: 'Airport Express Line (Delhi Metro)', start: '04:45', end: '23:30', every: 10, fare: [50, 60], toWhere: 'New Delhi Railway Station', minutes: 22, note: 'From Terminal 3. Fastest way into the city.' },
    { mode: 'bus', name: 'DTC airport bus', start: '05:00', end: '23:00', every: 30, fare: [25, 75], toWhere: 'ISBT Kashmere Gate', minutes: 70 },
  ],
  BOM: [
    { mode: 'metro', name: 'Metro Line 3 (Aqua Line)', start: '06:30', end: '22:30', every: 8, fare: [20, 70], toWhere: 'Churchgate / Cuffe Parade', minutes: 45, note: 'Stations at Terminal 1 and Terminal 2.' },
    { mode: 'bus', name: 'BEST airport bus', start: '05:00', end: '23:30', every: 20, fare: [15, 60], toWhere: 'Andheri / Santacruz station', minutes: 25 },
  ],
  BLR: [
    { mode: 'bus', name: 'BMTC Vayu Vajra (KIA buses)', start: '24h', every: 20, fare: [250, 350], toWhere: 'Majestic / MG Road', minutes: 75, note: 'AC airport buses on many routes across the city, round the clock.' },
  ],
  HYD: [
    { mode: 'bus', name: 'TGSRTC Pushpak airport liner', start: '24h', every: 30, fare: [250, 320], toWhere: 'Secunderabad / Mehdipatnam', minutes: 60 },
  ],
  MAA: [
    { mode: 'metro', name: 'Chennai Metro (Blue Line)', start: '05:00', end: '23:00', every: 7, fare: [20, 50], toWhere: 'Chennai Central', minutes: 30, note: 'Airport station is a short walk from arrivals.' },
  ],
  CCU: [
    { mode: 'bus', name: 'WBTC AC airport bus', start: '06:00', end: '22:00', every: 30, fare: [50, 100], toWhere: 'Esplanade / Howrah', minutes: 60 },
  ],
  COK: [
    { mode: 'bus', name: 'KSRTC AC airport feeder', start: '05:00', end: '23:00', every: 45, fare: [80, 150], toWhere: 'Ernakulam / Fort Kochi', minutes: 60 },
  ],
  PNQ: [
    { mode: 'bus', name: 'PMPML airport bus', start: '06:00', end: '22:00', every: 40, fare: [25, 50], toWhere: 'Pune Station / Swargate', minutes: 40 },
  ],
  GOI: [
    { mode: 'bus', name: 'KTC airport shuttle', start: '07:00', end: '21:00', every: 60, fare: [40, 100], toWhere: 'Panaji / Margao', minutes: 50 },
  ],
};
const GENERIC = { mode: 'bus', name: 'City bus / airport shuttle', start: '06:00', end: '22:00', every: 45, fare: [30, 80], toWhere: null, minutes: null, note: 'Timings vary - check at the arrivals help desk.' };

const CABS = [
  { key: 'mini', name: 'App cab - Mini', seats: 4, base: 70, perKm: 16, icon: 'local_taxi' },
  { key: 'sedan', name: 'App cab - Sedan', seats: 4, base: 90, perKm: 20, icon: 'directions_car' },
  { key: 'suv', name: 'App cab - SUV / XL', seats: 6, base: 130, perKm: 27, icon: 'airport_shuttle' },
  { key: 'prepaid', name: 'Prepaid taxi counter', seats: 4, base: 120, perKm: 21, icon: 'confirmation_number', prepaid: true },
];

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
const round10 = (n) => Math.round(n / 10) * 10;

function centreOf(code) {
  const c = CENTRES[code];
  const a = airports.get(code);
  return c ? { name: c[0], lat: c[1], lon: c[2] } : { name: `${a.city} city centre`, lat: a.lat + 0.05, lon: a.lon + 0.05 };
}

function trafficFactor(min) {
  const h = min / 60 % 24;
  if ((h >= 8 && h < 11) || (h >= 17 && h < 21)) return 1.45;
  if (h >= 23 || h < 5) return 0.8;
  return 1.1;
}
const isNight = (min) => { const h = min / 60 % 24; return h >= 23 || h < 5; };

function running(svc, atMin) {
  if (svc.start === '24h') return true;
  const s = toMin(svc.start); const e = toMin(svc.end); const t = ((atMin % 1440) + 1440) % 1440;
  return e > s ? t >= s && t <= e : t >= s || t <= e;
}
function nextDepartures(svc, atMin, n = 3) {
  const t = ((atMin % 1440) + 1440) % 1440;
  if (svc.start === '24h') { const first = Math.ceil(t / svc.every) * svc.every; return Array.from({ length: n }, (_, i) => hhmm(first + i * svc.every)); }
  const s = toMin(svc.start);
  if (!running(svc, t)) return [];
  const first = s + Math.ceil(Math.max(0, t - s) / svc.every) * svc.every;
  return Array.from({ length: n }, (_, i) => first + i * svc.every).filter((m) => running(svc, m)).map(hhmm);
}

/**
 * @param code    arrival airport code
 * @param atMin   minutes after midnight IST when the traveller will be at the kerb
 * @param nowMs   "live" clock for simulated cab availability
 */
function options(code, atMin, nowMs = Date.now()) {
  const a = airports.get(code);
  if (!a) return null;
  const centre = centreOf(code);
  const roadKm = Math.max(6, airports.distanceKm(a, centre) * 1.35);
  const driveMin = Math.round((roadKm / 32) * 60 * trafficFactor(atMin) / 5) * 5;
  // live-ish availability, re-rolled every 3 minutes
  const r = flights.rng(flights.seedFrom(`${code}|${Math.floor(nowMs / 180000)}|${Math.floor(atMin / 30)}`));
  const night = isNight(atMin);
  const busyAirport = ['DEL', 'BOM', 'BLR', 'HYD', 'MAA', 'CCU'].includes(code);
  const surge = +(1 + (trafficFactor(atMin) > 1.3 ? 0.25 : 0) + (night ? 0.15 : 0) + r() * 0.15).toFixed(2);

  const cabs = CABS.map((c) => {
    const nearby = c.prepaid ? null : Math.max(0, Math.round((busyAirport ? 14 : 5) * (night ? 0.45 : 1) * (0.6 + r() * 0.8)) - (c.key === 'suv' ? 3 : 0));
    const mult = c.prepaid ? (night ? 1.25 : 1) : surge;
    const fare = (c.base + roadKm * c.perKm) * mult;
    const available = c.prepaid ? true : nearby > 0;
    return {
      type: 'cab', key: c.key, name: c.name, icon: c.icon, seats: c.seats, available,
      etaMin: c.prepaid ? 5 : available ? Math.max(2, Math.round(3 + r() * 9)) : null,
      nearby, surge: c.prepaid ? null : mult > 1.05 ? mult : null,
      fare: [round10(fare * 0.92), round10(fare * 1.12)], durationMin: driveMin,
      note: c.prepaid ? (night ? 'Fixed fare paid at the counter. 25% night charge applies (11pm-5am).' : 'Fixed fare paid at the counter in the arrivals hall.') : null,
    };
  });

  const transit = (TRANSIT[code] || [GENERIC]).map((s) => {
    const ok = running(s, atMin);
    return {
      type: s.mode, name: s.name, available: ok,
      hours: s.start === '24h' ? 'Round the clock' : `${s.start} - ${s.end}`,
      every: s.every, next: nextDepartures(s, atMin), fare: s.fare, durationMin: s.minutes,
      toWhere: s.toWhere || centre.name, note: s.note || null,
      firstService: ok || s.start === '24h' ? null : s.start,
    };
  });

  const drop = encodeURIComponent(centre.name);
  return {
    airport: airports.publicShape(a), destination: centre, roadKm: Math.round(roadKm), at: hhmm(atMin),
    cabs, transit, indicative: true,
    links: {
      uber: `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${a.lat}&pickup[longitude]=${a.lon}&pickup[nickname]=${encodeURIComponent(a.city + ' Airport')}&dropoff[latitude]=${centre.lat}&dropoff[longitude]=${centre.lon}&dropoff[nickname]=${drop}`,
      directions: `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${centre.lat},${centre.lon}&travelmode=transit`,
    },
    best: {
      cab: cabs.filter((c) => c.available).sort((x, y) => x.fare[0] - y.fare[0])[0] || null,
      transit: transit.find((t) => t.available) || null,
    },
  };
}

module.exports = { options, centreOf, running, nextDepartures, CENTRES };
