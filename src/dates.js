'use strict';
// All "calendar" logic is done in India Standard Time because every airport in the demo is Indian.
const TZ = 'Asia/Kolkata';
const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const todayIST = (now = new Date()) => fmtDate.format(now);
const nowMinutesIST = (now = new Date()) => { const [h, m] = fmtTime.format(now).split(':').map(Number); return h * 60 + m; };

const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const toUTC = (s) => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 86400000);
const weekday = (s) => toUTC(s).getUTCDay(); // 0 = Sunday

module.exports = { TZ, todayIST, nowMinutesIST, isISODate, addDays, diffDays, weekday };
