'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const airports = require('./airports');
const dates = require('./dates');
const flights = require('./flights');
const offers = require('./offers');
const payments = require('./payments');
const security = require('./security');
const validate = require('./validate');
const { makeService } = require('./bookings');
const tracking = require('./tracking');
const transport = require('./transport');
const assistant = require('./assistant');
const { HttpError, ValidationError } = validate;

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ db, publicDir = config.publicDir } = {}) {
  const app = express();
  const bookings = makeService(db);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.set('etag', 'strong');

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, name, email FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)'),
    sessionUser: db.prepare('SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sweepSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    insertTicket: db.prepare('INSERT INTO support_tickets (name, email, message, user_id) VALUES (?,?,?,?)'),
  };

  // ---------- global middleware ----------
  app.use(security.securityHeaders);
  app.use(compression());

  // ---------- static site ----------
  const longCache = 'public, max-age=31536000, immutable';
  app.use(express.static(publicDir, {
    dotfiles: 'deny', index: 'index.html', extensions: ['html'], redirect: false,
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', longCache);
      else if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }));

  // ---------- API ----------
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(security.rateLimit({ windowMs: 60_000, max: 240, bucket: 'api' }));
  api.use(express.json({ limit: '20kb' }));
  api.use(security.csrfGuard);

  // session -> req.user
  api.use((req, res, next) => {
    const raw = security.parseCookies(req.headers.cookie)[config.cookieName];
    req.user = null;
    if (raw && /^[A-Za-z0-9_-]{20,80}$/.test(raw)) {
      const hash = security.sha256(raw);
      const u = q.sessionUser.get(hash, Date.now());
      if (u) { req.user = u; req.sessionHash = hash; }
    }
    next();
  });
  const requireUser = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'unauthorized', 'Please log in to continue.')));

  api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // ----- reference data -----
  api.get('/airports', (req, res) => res.json({ airports: airports.search(req.query.q, 8) }));
  api.get('/offers', (req, res) => res.json({ offers: offers.OFFERS.map(offers.publicShape) }));

  function parseSearch(query) {
    const f = {};
    const from = airports.resolve(query.from); const to = airports.resolve(query.to);
    if (!from) f.from = 'Choose a departure city from the list.';
    if (!to) f.to = 'Choose a destination city from the list.';
    if (from && to && from.code === to.code) f.to = 'Origin and destination cannot be the same.';
    const date = String(query.date || '');
    const today = dates.todayIST();
    if (!dates.isISODate(date)) f.date = 'Pick a departure date.';
    else if (date < today) f.date = 'Departure date cannot be in the past.';
    else if (date > dates.addDays(today, 330)) f.date = 'Flights can be booked up to 330 days ahead.';
    const cabin = query.cabin ? String(query.cabin) : 'Economy';
    if (!flights.CABINS[cabin]) f.cabin = 'Unknown cabin class.';
    const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
    const counts = { adults: num(query.adults, 1), children: num(query.children, 0), infants: num(query.infants, 0) };
    if (!Number.isInteger(counts.adults) || counts.adults < 1 || counts.adults > 9) f.adults = 'Between 1 and 9 adults.';
    if (!Number.isInteger(counts.children) || counts.children < 0 || counts.children > 6) f.children = 'Between 0 and 6 children.';
    if (!Number.isInteger(counts.infants) || counts.infants < 0 || counts.infants > Math.max(0, counts.adults || 0)) f.infants = 'Each infant needs an adult.';
    if (Object.keys(f).length) throw new ValidationError(f);
    return { from, to, date, cabin, counts, direct: query.direct === '1' || query.direct === 'true' };
  }

  api.get('/flights/search', security.rateLimit({ windowMs: 60_000, max: 90, bucket: 'search' }), (req, res) => {
    const s = parseSearch(req.query);
    const list = flights.search({ from: s.from.code, to: s.to.code, date: s.date, cabin: s.cabin, direct: s.direct });
    const airlines = [...new Map(list.map((f) => [f.airline.code, f.airline])).values()];
    res.json({
      query: { from: airports.publicShape(s.from), to: airports.publicShape(s.to), date: s.date, cabin: s.cabin, ...s.counts, direct: s.direct },
      count: list.length, airlines, flights: list,
      stats: list.length ? { cheapest: Math.min(...list.map((f) => f.price)), fastest: Math.min(...list.map((f) => f.durationMin)) } : null,
    });
  });

  api.get('/flights/calendar', security.rateLimit({ windowMs: 60_000, max: 60, bucket: 'cal' }), (req, res) => {
    const s = parseSearch(req.query);
    res.json({ days: flights.calendar({ from: s.from.code, to: s.to.code, date: s.date, cabin: s.cabin }) });
  });

  api.get('/deals', (req, res) => {
    const from = airports.resolve(req.query.from) || airports.get('BOM');
    const today = dates.todayIST();
    const picks = ['DEL', 'BLR', 'HYD', 'GOI', 'IXL'].filter((c) => c !== from.code);
    const deals = picks.map((code) => {
      const to = airports.get(code); let best = Infinity; let bestDate = null;
      for (let n = 3; n <= 24; n++) {
        const d = dates.addDays(today, n);
        for (const f of flights.generate(from.code, code, d, 'Economy')) if (f.price < best) { best = f.price; bestDate = d; }
      }
      return { code, city: to.city, from: best, date: bestDate };
    });
    res.json({ origin: airports.publicShape(from), deals });
  });

  // ----- auth -----
  const authLimiter = security.rateLimit({ windowMs: 10 * 60_000, max: 20, bucket: 'auth', message: 'Too many attempts. Please wait a few minutes and try again.' });

  function startSession(req, res, userId) {
    const token = security.newToken();
    q.insertSession.run(security.sha256(token), userId, Date.now() + config.sessionDays * 86400000);
    res.setHeader('Set-Cookie', security.sessionCookie(req, token, config.sessionDays * 86400));
  }

  api.post('/auth/register', authLimiter, asyncRoute(async (req, res) => {
    const f = {};
    const name = validate.personName(req.body.name);
    const email = validate.email(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!name) f.name = 'Enter your name (letters only).';
    if (!email) f.email = 'Enter a valid e-mail address.';
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) f.password = 'Use 8-72 characters with at least one letter and one number.';
    if (Object.keys(f).length) throw new ValidationError(f);
    if (q.userByEmail.get(email)) throw new ValidationError({ email: 'An account with this e-mail already exists. Try logging in.' });
    const info = q.insertUser.run(name, email, await security.hashPassword(password));
    const id = Number(info.lastInsertRowid);
    startSession(req, res, id);
    res.status(201).json({ user: { id, name, email } });
  }));

  api.post('/auth/login', authLimiter, asyncRoute(async (req, res) => {
    const email = validate.email(req.body.email); const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = email ? q.userByEmail.get(email) : null;
    const ok = await security.verifyPassword(password.slice(0, 200), user ? user.password_hash : security.DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect e-mail or password.');
    startSession(req, res, user.id);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  }));

  api.post('/auth/logout', (req, res) => {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    res.setHeader('Set-Cookie', security.sessionCookie(req, '', 0));
    res.json({ ok: true });
  });
  api.get('/auth/me', (req, res) => res.json({ user: req.user }));

  // ----- bookings -----
  const payLimiter = security.rateLimit({ windowMs: 10 * 60_000, max: 25, bucket: 'pay', message: 'Too many payment attempts. Please wait a few minutes.' });
  api.post('/bookings', (req, res) => {
    const b = req.body || {};
    res.status(201).json({ booking: bookings.createHold({ tripType: b.tripType, flightIds: b.flightIds, adults: b.adults, children: b.children, infants: b.infants, cabin: b.cabin }, req.user?.id) });
  });
  api.post('/bookings/lookup', security.rateLimit({ windowMs: 10 * 60_000, max: 15, bucket: 'lookup' }), (req, res) => {
    res.json({ booking: bookings.lookup(req.body.pnr, req.body.email) });
  });
  api.get('/me/bookings', requireUser, (req, res) => res.json({ bookings: bookings.listForUser(req.user.id) }));
  api.get('/bookings/:token', (req, res) => res.json({ booking: bookings.get(req.params.token) }));
  api.put('/bookings/:token/passengers', (req, res) => res.json({ booking: bookings.setPassengers(req.params.token, req.body || {}, req.user?.id) }));
  api.post('/bookings/:token/promo', (req, res) => {
    const out = bookings.setPromo(req.params.token, req.body?.code);
    const { promoMessage, ...booking } = out;
    res.json({ booking, message: promoMessage });
  });
  api.post('/bookings/:token/pay', payLimiter, (req, res) => res.json({ booking: bookings.pay(req.params.token, req.body || {}, req.user?.id) }));
  api.post('/bookings/:token/cancel', (req, res) => res.json({ booking: bookings.cancel(req.params.token) }));
  // ----- trip reminders + calendar -----
  api.get('/bookings/:token/reminders', (req, res) => res.json({ reminders: bookings.listReminders(req.params.token) }));
  api.post('/bookings/:token/reminders', security.rateLimit({ windowMs: 60_000, max: 30, bucket: 'rem' }), (req, res) => res.status(201).json({ reminders: bookings.addReminder(req.params.token, req.body || {}) }));
  api.delete('/bookings/:token/reminders/:id', (req, res) => res.json({ reminders: bookings.deleteReminder(req.params.token, req.params.id) }));
  api.get('/bookings/:token/calendar.ics', (req, res) => {
    const ics = bookings.calendar(req.params.token);
    res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
    res.type('text/calendar; charset=utf-8').send(ics.body);
  });
  api.get('/me/reminders', requireUser, (req, res) => res.json({ reminders: bookings.remindersForUser(req.user.id) }));

  api.get('/payment-banks', (req, res) => res.json({ banks: payments.BANKS }));

  // ----- live flight status (simulated) -----
  const trackLimiter = security.rateLimit({ windowMs: 60_000, max: 120, bucket: 'track' });
  api.get('/track/live', trackLimiter, (req, res) => res.json({ flights: tracking.liveNow(), simulated: true, airports: airports.AIRPORTS.map((a) => ({ code: a.code, city: a.city, lat: a.lat, lon: a.lon })) }));
  api.get('/track/search', trackLimiter, (req, res) => {
    const number = validate.str(req.query.number, 12); const date = String(req.query.date || dates.todayIST());
    const f = {};
    if (!/^\s*(6E|AI|QP|SG)\s*-?\s*\d{3}\s*$/i.test(number)) f.number = 'Enter a flight number like 6E 245, AI 101, QP 1xx or SG 4xx.';
    if (!dates.isISODate(date)) f.date = 'Pick a date.';
    else if (Math.abs(dates.diffDays(date, dates.todayIST())) > 3) f.date = 'Live status is available from 3 days before to 3 days after the flight.';
    if (Object.keys(f).length) throw new ValidationError(f);
    res.json({ flights: tracking.findByNumber(number, date) });
  });
  api.get('/track/:id', trackLimiter, (req, res) => {
    const s = tracking.status(req.params.id);
    if (!s) throw new HttpError(404, 'not_found', 'We could not find that flight.');
    res.json({ flight: s });
  });

  // ----- airport transfers -----
  api.get('/transfers', security.rateLimit({ windowMs: 60_000, max: 60, bucket: 'transfers' }), (req, res) => {
    const a = airports.resolve(req.query.airport);
    const f = {};
    if (!a) f.airport = 'Choose an airport from the list.';
    const time = String(req.query.time || '');
    let at;
    if (!time) at = dates.nowMinutesIST() + 20;
    else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { const [h, m] = time.split(':').map(Number); at = h * 60 + m; } else f.time = 'Use a time like 14:30.';
    if (Object.keys(f).length) throw new ValidationError(f);
    res.json(transport.options(a.code, at));
  });

  // ----- AI customer service -----
  api.post('/assistant', security.rateLimit({ windowMs: 60_000, max: 20, bucket: 'assistant', message: 'You are sending messages very quickly. Please wait a moment.' }), asyncRoute(async (req, res) => {
    const out = await assistant.reply({ messages: req.body?.messages, context: req.body?.context || {} }, { bookings });
    res.json(out);
  }));
  api.get('/assistant/info', (req, res) => res.json({ ai: !!config.anthropicKey }));

  // ----- support -----
  api.post('/support', security.rateLimit({ windowMs: 10 * 60_000, max: 6, bucket: 'support' }), (req, res) => {
    const f = {};
    const name = validate.str(req.body.name, 80); const email = validate.email(req.body.email); const message = validate.str(req.body.message, 2000);
    if (name.length < 2) f.name = 'Please enter your name.';
    if (!email) f.email = 'Enter a valid e-mail address.';
    if (message.length < 10) f.message = 'Please tell us a little more (at least 10 characters).';
    if (Object.keys(f).length) throw new ValidationError(f);
    const info = q.insertTicket.run(name, email, message, req.user?.id ?? null);
    res.status(201).json({ ticket: `FC-${String(info.lastInsertRowid).padStart(5, '0')}` });
  });

  api.use((req, res) => res.status(404).json({ error: 'not_found', message: 'No such API endpoint.' }));
  api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Malformed JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Request body too large.' });
    if (err instanceof ValidationError) return res.status(422).json({ error: 'validation', message: err.message, fields: err.fields });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    console.error('[api error]', err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again.' });
  });
  app.use('/api', api);

  app.get('/healthz', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('text/plain').send('ok'); });

  // ---------- 404 for pages ----------
  const notFoundFile = path.join(publicDir, '404.html');
  app.use((req, res) => {
    res.status(404);
    if (req.accepts('html') && fs.existsSync(notFoundFile)) res.sendFile(notFoundFile);
    else res.type('text/plain').send('Not found');
  });
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[error]', err);
    res.status(500).type('text/plain').send('Internal server error');
  });

  // housekeeping: expire stale fare holds and old sessions
  const timer = setInterval(() => { try { bookings.sweep(); q.sweepSessions.run(Date.now()); } catch (e) { console.error(e); } }, 5 * 60_000);
  timer.unref();
  app.locals.close = () => clearInterval(timer);
  return app;
}

module.exports = { createApp };
