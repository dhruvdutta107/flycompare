'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const dates = require('../src/dates');
const flights = require('../src/flights');

let server; let base; let app;
before(async () => {
  app = createApp({ db: open(':memory:') });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { app.locals.close(); server.close(); });

// minimal client with a cookie jar
function client() {
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null; try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data, headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b), call };
}

const in10 = dates.addDays(dates.todayIST(), 10);
const in14 = dates.addDays(dates.todayIST(), 14);
const adultDob = '1995-04-12';
const paxBody = (n = 1) => ({ passengers: Array.from({ length: n }, (_, i) => ({ title: 'Mr', first: 'Dhruv', last: 'Dutta' + (i ? 'B' : ''), dob: adultDob })), email: 'dhruv@example.com', phone: '9876543210' });
const goodCard = { method: 'card', cardNumber: '4111 1111 1111 1111', expiry: '12/35', cvv: '123', cardName: 'Dhruv Dutta' };

test('security headers are present and sensitive paths are not exposed', async () => {
  const c = client();
  const r = await fetch(base + '/api/health');
  for (const h of ['content-security-policy', 'permissions-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options']) assert.ok(r.headers.get(h), h);
  assert.equal(r.headers.get('x-powered-by'), null);
  for (const p of ['/.git/config', '/backup.sql', '/server-status', '/phpinfo.php', '/.env', '/../package.json', '/data/flycompare.db']) {
    const x = await fetch(base + p); assert.ok([403, 404].includes(x.status), `${p} -> ${x.status}`);
  }
  assert.equal((await c.get('/api/nope')).status, 404);
});

test('airport autocomplete', async () => {
  const c = client();
  const r = await c.get('/api/airports?q=mum');
  assert.equal(r.data.airports[0].code, 'BOM');
  assert.ok((await c.get('/api/airports')).data.airports.length >= 5);
});

test('flight search validates input and is deterministic', async () => {
  const c = client();
  const bad = await c.get('/api/flights/search?from=BOM&to=BOM&date=' + in10);
  assert.equal(bad.status, 422); assert.ok(bad.data.fields.to);
  assert.equal((await c.get('/api/flights/search?from=BOM&to=DEL&date=2001-01-01')).status, 422);
  const a = await c.get(`/api/flights/search?from=Mumbai%20(BOM)&to=DEL&date=${in10}`);
  const b = await c.get(`/api/flights/search?from=BOM&to=DEL&date=${in10}`);
  assert.equal(a.status, 200); assert.ok(a.data.count >= 8);
  assert.deepEqual(a.data.flights, b.data.flights);
  const direct = await c.get(`/api/flights/search?from=BOM&to=DEL&date=${in10}&direct=1`);
  assert.ok(direct.data.flights.every((f) => f.stops === 0));
  const cal = await c.get(`/api/flights/calendar?from=BOM&to=DEL&date=${in10}`);
  assert.equal(cal.data.days.length, 7);
});

test('full booking flow: hold -> passengers -> promo -> declined card -> success -> lookup -> cancel', async () => {
  const c = client();
  const out = (await c.get(`/api/flights/search?from=BOM&to=DEL&date=${in10}`)).data.flights[0];
  const back = (await c.get(`/api/flights/search?from=DEL&to=BOM&date=${in14}`)).data.flights[0];
  const hold = await c.post('/api/bookings', { tripType: 'return', flightIds: [out.id, back.id], adults: 2, children: 0, infants: 0, cabin: 'Economy' });
  assert.equal(hold.status, 201);
  const b = hold.data.booking; const t = b.token;
  assert.equal(b.pricing.gross, (out.price + back.price) * 2);
  assert.equal(b.status, 'held'); assert.ok(b.holdSecondsLeft > 1000);

  // can't pay before passenger details
  assert.equal((await c.post(`/api/bookings/${t}/pay`, goodCard)).status, 409);

  // validation messages per field
  const badPax = await c.put(`/api/bookings/${t}/passengers`, { passengers: [{ title: 'Mr', first: '', last: 'X1', dob: '2030-01-01' }, paxBody(1).passengers[0]], email: 'nope', phone: '123' });
  assert.equal(badPax.status, 422);
  for (const k of ['p0.first', 'p0.last', 'p0.dob', 'email', 'phone']) assert.ok(badPax.data.fields[k], k);

  const okPax = await c.put(`/api/bookings/${t}/passengers`, paxBody(2));
  assert.equal(okPax.status, 200); assert.equal(okPax.data.booking.contact.email, 'dhruv@example.com');

  // promo
  assert.equal((await c.post(`/api/bookings/${t}/promo`, { code: 'BOGUS' })).status, 422);
  const promo = await c.post(`/api/bookings/${t}/promo`, { code: 'summer40' });
  assert.equal(promo.status, 200);
  const d = promo.data.booking.pricing; assert.equal(d.promoCode, 'SUMMER40'); assert.equal(d.total, d.gross - d.discount); assert.ok(d.discount > 0 && d.discount <= 2000);
  const removed = await c.post(`/api/bookings/${t}/promo`, { code: '' });
  assert.equal(removed.data.booking.pricing.discount, 0);
  await c.post(`/api/bookings/${t}/promo`, { code: 'NEWUSER500' });

  // per-field card errors
  const invalid = await c.post(`/api/bookings/${t}/pay`, { method: 'card', cardNumber: '4111 1111 1111 1112', expiry: '13/99', cvv: '12', cardName: '' });
  assert.equal(invalid.status, 422);
  for (const k of ['cardNumber', 'expiry', 'cvv', 'cardName']) assert.ok(invalid.data.fields[k], k);
  assert.equal((await c.post(`/api/bookings/${t}/pay`, { ...goodCard, expiry: '01/20' })).data.fields.expiry, 'This card has expired.');

  // bank decline keeps booking open
  const declined = await c.post(`/api/bookings/${t}/pay`, { ...goodCard, cardNumber: '4000 0000 0000 0002' });
  assert.equal(declined.status, 402); assert.equal(declined.data.error, 'payment_failed');
  assert.equal((await c.get(`/api/bookings/${t}`)).data.booking.status, 'held');

  // success
  const paid = await c.post(`/api/bookings/${t}/pay`, goodCard);
  assert.equal(paid.status, 200);
  const pb = paid.data.booking;
  assert.equal(pb.status, 'confirmed'); assert.match(pb.pnr, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(pb.payment.last4, '1111'); assert.equal(JSON.stringify(pb).includes('4111111111111111'), false);
  assert.equal(pb.pricing.promoCode, 'NEWUSER500'); assert.equal(pb.pricing.total, pb.pricing.gross - 500);
  // idempotent
  assert.equal((await c.post(`/api/bookings/${t}/pay`, goodCard)).data.booking.pnr, pb.pnr);
  // can't edit after confirmation
  assert.equal((await c.put(`/api/bookings/${t}/passengers`, paxBody(2))).status, 409);

  // lookup: right vs wrong e-mail look identical
  const ok = await c.post('/api/bookings/lookup', { pnr: pb.pnr.toLowerCase(), email: 'DHRUV@example.com' });
  assert.equal(ok.status, 200);
  const wrong = await c.post('/api/bookings/lookup', { pnr: pb.pnr, email: 'someone@else.com' });
  const missing = await c.post('/api/bookings/lookup', { pnr: 'ZZZZZZ', email: 'dhruv@example.com' });
  assert.equal(wrong.status, 404); assert.deepEqual(wrong.data, missing.data);

  // cancel + refund
  const cancel = await c.post(`/api/bookings/${t}/cancel`);
  assert.equal(cancel.data.booking.status, 'cancelled');
  assert.equal(cancel.data.booking.refund, pb.pricing.total - 250 * 2 * 2);
});

test('booking input is validated server-side (tampering, bad combos)', async () => {
  const c = client();
  const list = (await c.get(`/api/flights/search?from=BOM&to=DEL&date=${in10}`)).data.flights;
  const base = { tripType: 'oneway', adults: 1, children: 0, infants: 0, cabin: 'Economy' };
  assert.equal((await c.post('/api/bookings', { ...base, flightIds: ['6E999-BOMDEL-20301010-E'] })).status, 409);
  assert.equal((await c.post('/api/bookings', { ...base, flightIds: [list[0].id], infants: 2 })).status, 422);
  assert.equal((await c.post('/api/bookings', { ...base, flightIds: [list[0].id], adults: 10 })).status, 422);
  assert.equal((await c.post('/api/bookings', { ...base, flightIds: [list[0].id], cabin: 'Business' })).status, 422);
  assert.equal((await c.post('/api/bookings', { ...base, tripType: 'return', flightIds: [list[0].id, list[1].id] })).status, 422);
  // client-supplied prices are ignored
  const r = await c.post('/api/bookings', { ...base, flightIds: [list[0].id], total: 1, price: 1 });
  assert.equal(r.data.booking.pricing.total, list[0].price);
  assert.equal((await c.get('/api/bookings/does-not-exist-does-not-exist')).status, 404);
});

test('infant / child age rules', async () => {
  const c = client();
  const f = (await c.get(`/api/flights/search?from=BOM&to=GOI&date=${in10}`)).data.flights[0];
  const t = (await c.post('/api/bookings', { tripType: 'oneway', flightIds: [f.id], adults: 1, children: 1, infants: 1, cabin: 'Economy' })).data.booking.token;
  const y = Number(in10.slice(0, 4));
  const body = { passengers: [{ title: 'Mr', first: 'Asha', last: 'Rao', dob: '1990-01-01' }, { title: 'Miss', first: 'Mira', last: 'Rao', dob: `${y - 6}-01-01` }, { title: 'Mstr', first: 'Kabir', last: 'Rao', dob: `${y - 1}-06-01` }], email: 'a@b.co', phone: '9123456780' };
  const ok = await c.put(`/api/bookings/${t}/passengers`, body);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.booking.pricing.gross, f.price * 2 + f.infantPrice);
  body.passengers[2].dob = '2015-01-01';
  assert.ok((await c.put(`/api/bookings/${t}/passengers`, body)).data.fields['p2.dob']);
});

test('accounts: register, login, wrong password, my trips, logout', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { name: 'Dhruv', email: 'x@y.com', password: 'short' })).status, 422);
  const reg = await c.post('/api/auth/register', { name: 'Dhruv', email: 'Dhruv@Example.com', password: 'Passw0rdOK' });
  assert.equal(reg.status, 201); assert.equal(reg.data.user.email, 'dhruv@example.com');
  assert.equal(reg.headers.get('set-cookie').includes('HttpOnly'), true);
  assert.equal(reg.headers.get('set-cookie').includes('SameSite=Lax'), true);
  assert.equal((await c.get('/api/auth/me')).data.user.name, 'Dhruv');
  assert.equal((await c.post('/api/auth/register', { name: 'Other', email: 'dhruv@example.com', password: 'Passw0rdOK' })).status, 422);

  // a booking made while logged in shows up under My Trips
  const f = (await c.get(`/api/flights/search?from=PNQ&to=BLR&date=${in10}`)).data.flights[0];
  const t = (await c.post('/api/bookings', { tripType: 'oneway', flightIds: [f.id], adults: 1, cabin: 'Economy' })).data.booking.token;
  await c.put(`/api/bookings/${t}/passengers`, paxBody(1));
  await c.post(`/api/bookings/${t}/pay`, goodCard);
  const mine = await c.get('/api/me/bookings');
  assert.equal(mine.data.bookings.length, 1);

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  assert.equal((await c.get('/api/me/bookings')).status, 401);
  const bad = await c.post('/api/auth/login', { email: 'dhruv@example.com', password: 'wrongpass1' });
  const none = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrongpass1' });
  assert.equal(bad.status, 401); assert.deepEqual(bad.data, none.data);
  const login = await c.post('/api/auth/login', { email: 'dhruv@example.com', password: 'Passw0rdOK' });
  assert.equal(login.status, 200);
  assert.equal((await c.get('/api/me/bookings')).data.bookings[0].pnr, mine.data.bookings[0].pnr);
});

test('NEWUSER500 only works once per customer', async () => {
  const c = client();
  const f = (await c.get(`/api/flights/search?from=BOM&to=GOI&date=${in10}`)).data.flights;
  const make = async () => {
    const t = (await c.post('/api/bookings', { tripType: 'oneway', flightIds: [f[0].id], adults: 1, cabin: 'Economy' })).data.booking.token;
    await c.put(`/api/bookings/${t}/passengers`, { ...paxBody(1), email: 'repeat@example.com' });
    return t;
  };
  const t1 = await make();
  assert.equal((await c.post(`/api/bookings/${t1}/promo`, { code: 'NEWUSER500' })).status, 200);
  await c.post(`/api/bookings/${t1}/pay`, goodCard);
  const t2 = await make();
  const second = await c.post(`/api/bookings/${t2}/promo`, { code: 'NEWUSER500' });
  assert.equal(second.status, 422); assert.match(second.data.message, /first booking/);
});

test('CSRF guard, JSON-only and rate limits', async () => {
  const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const crossOrigin = await fetch(base + '/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
  const form = await fetch(base + '/api/support', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Requested-With': 'fetch' }, body: 'x' });
  assert.equal(form.status, 415);
  const c = client(); let last;
  for (let i = 0; i < 25; i++) last = await c.post('/api/auth/login', { email: 'a@b.co', password: 'nopenope1' });
  assert.equal(last.status, 429);
});

test('support tickets', async () => {
  const c = client();
  assert.equal((await c.post('/api/support', { name: '', email: 'bad', message: 'x' })).status, 422);
  const ok = await c.post('/api/support', { name: 'Dhruv', email: 'd@example.com', message: 'My booking has the wrong date, please help.' });
  assert.equal(ok.status, 201); assert.match(ok.data.ticket, /^FC-\d{5}$/);
});

test('flight engine: ids round-trip and same-day flights respect the 2h cut-off', () => {
  const now = new Date('2026-11-05T06:30:00Z'); // 12:00 IST
  const today = dates.todayIST(now);
  const list = flights.generate('BOM', 'DEL', today, 'Economy', now);
  assert.ok(list.every((f) => f.departMin > 14 * 60));
  const tomorrow = flights.generate('BOM', 'DEL', dates.addDays(today, 1), 'Business', now);
  assert.ok(tomorrow.length && tomorrow.every((f) => flights.findById(f.id, now)?.price === f.price));
  assert.ok(tomorrow[0].price > flights.generate('BOM', 'DEL', dates.addDays(today, 1), 'Economy', now)[0].price);
});

// ---------- new features: live tracking, transfers, reminders + calendar, assistant ----------
const tracking = require('../src/tracking');
const transport = require('../src/transport');

test('live flight status moves through its phases and the plane follows the route', () => {
  const date = dates.todayIST();
  const f = flights.generate('BOM', 'DEL', date, 'Economy', new Date(), { includeDeparted: true }).find((x) => x.stops === 0);
  const dep = Date.parse(`${date}T00:00:00+05:30`) + f.departMin * 60000;
  const at = (minutes) => tracking.status(f.id, new Date(dep + minutes * 60000));
  const s0 = at(-30 * 60); const s1 = at(-30); const end = at(f.durationMin + 200);
  assert.equal(s0.phase, 'scheduled');
  assert.ok(['boarding', 'checkin', 'gate_closed'].includes(s1.phase));
  assert.equal(end.phase, 'arrived'); assert.equal(end.progress, 1); assert.ok(end.to.belt >= 1);
  const air = at(f.durationMin / 2 + s0.delayMin);
  assert.equal(air.phase, 'en_route');
  assert.ok(air.position.lat > 19 && air.position.lat < 28.6 && air.position.altitudeFt > 20000);
  assert.ok(tracking.findByNumber(f.number.replace(' ', ''), date).some((m) => m.id === f.id));
  assert.equal(tracking.status('nonsense'), null);
});

test('tracking + transfers API', async () => {
  const c = client();
  const live = await c.get('/api/track/live');
  assert.equal(live.status, 200); assert.ok(Array.isArray(live.data.flights));
  assert.equal((await c.get('/api/track/search?number=XX999')).status, 422);
  const f = flights.generate('DEL', 'BLR', dates.todayIST(), 'Economy', new Date(), { includeDeparted: true })[0];
  const s = await c.get('/api/track/search?number=' + encodeURIComponent(f.number) + '&date=' + dates.todayIST());
  assert.ok(s.data.flights.some((x) => x.id === f.id));
  const st = await c.get('/api/track/' + f.id);
  assert.equal(st.data.flight.number, f.number); assert.equal(st.data.flight.simulated, true);
  assert.equal((await c.get('/api/track/AB123-XXXYYY-20260101-E')).status, 404);

  const night = await c.get('/api/transfers?airport=DEL&time=02:10');
  assert.equal(night.status, 200);
  const metro = night.data.transit.find((t) => t.type === 'metro');
  assert.equal(metro.available, false); assert.equal(metro.firstService, '04:45');
  assert.ok(night.data.cabs.find((x) => x.key === 'prepaid').note.includes('night'));
  const day = await c.get('/api/transfers?airport=Bengaluru&time=14:00');
  assert.ok(day.data.transit[0].available && day.data.transit[0].next.length === 3);
  assert.ok(day.data.links.uber.startsWith('https://m.uber.com/'));
  assert.equal((await c.get('/api/transfers?airport=XYZ')).status, 422);
  assert.equal((await c.get('/api/transfers?airport=BOM&time=25:00')).status, 422);
  assert.deepEqual(transport.nextDepartures({ start: '06:00', end: '22:00', every: 30 }, 21 * 60 + 40), ['22:00']);
});

async function confirmedBooking(c, from = 'BOM', to = 'GOI') {
  const out = (await c.get(`/api/flights/search?from=${from}&to=${to}&date=${in10}`)).data.flights[0];
  const t = (await c.post('/api/bookings', { tripType: 'oneway', flightIds: [out.id], adults: 1, children: 0, infants: 0, cabin: 'Economy' })).data.booking.token;
  await c.put(`/api/bookings/${t}/passengers`, paxBody(1));
  const paid = await c.post(`/api/bookings/${t}/pay`, goodCard);
  assert.equal(paid.data.booking.status, 'confirmed');
  return paid.data.booking;
}

test('trip reminders and calendar export', async () => {
  const c = client();
  const out = (await c.get(`/api/flights/search?from=BOM&to=GOI&date=${in10}`)).data.flights[0];
  const held = (await c.post('/api/bookings', { tripType: 'oneway', flightIds: [out.id], adults: 1, children: 0, infants: 0, cabin: 'Economy' })).data.booking;
  assert.equal((await c.post(`/api/bookings/${held.token}/reminders`, { kind: 'checkin' })).status, 409); // not paid yet

  const b = await confirmedBooking(c);
  const t = b.token;
  let r = await c.post(`/api/bookings/${t}/reminders`, { kind: 'checkin' });
  assert.equal(r.status, 201); assert.equal(r.data.reminders.length, 1);
  assert.equal(r.data.reminders[0].minutesBefore, 1440);
  r = await c.post(`/api/bookings/${t}/reminders`, { kind: 'checkin' }); // idempotent
  assert.equal(r.data.reminders.length, 1);
  r = await c.post(`/api/bookings/${t}/reminders`, { kind: 'custom', minutesBefore: 120 });
  assert.equal(r.data.reminders.length, 2);
  assert.equal((await c.post(`/api/bookings/${t}/reminders`, { kind: 'custom', minutesBefore: 7 })).status, 422);
  assert.equal((await c.post(`/api/bookings/${t}/reminders`, { kind: 'leave', legIndex: 3 })).status, 422);
  const leg = b.legs[0];
  const dep = Date.parse(`${leg.date}T00:00:00+05:30`) + leg.departMin * 60000;
  assert.equal(r.data.reminders.find((x) => x.kind === 'checkin').remindAt, dep - 1440 * 60000);

  const ics = await fetch(`${base}/api/bookings/${t}/calendar.ics`);
  const body = await ics.text();
  assert.equal(ics.status, 200); assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(body, /BEGIN:VEVENT[\s\S]*TRIGGER:-PT1440M[\s\S]*TRIGGER:-PT120M[\s\S]*END:VCALENDAR/);
  assert.ok(body.includes(`UID:${b.pnr}-0@flycompare`));

  const id = r.data.reminders[0].id;
  r = await c.call('DELETE', `/api/bookings/${t}/reminders/${id}`, {});
  assert.equal(r.data.reminders.length, 1);
  await c.post(`/api/bookings/${t}/cancel`);
  assert.equal((await c.get(`/api/bookings/${t}/reminders`)).data.reminders.length, 0);
});

test('assistant answers from real data and never leaks a booking without PNR + e-mail', async () => {
  const c = client();
  const b = await confirmedBooking(c, 'DEL', 'BLR');
  const ask = (text, context) => c.post('/api/assistant', { messages: [{ role: 'user', content: text }], context });
  let r = await ask('hello');
  assert.equal(r.status, 200); assert.equal(r.data.intent, 'greet'); assert.ok(r.data.suggestions.length);
  r = await ask(`can I cancel ${b.pnr}?`);
  assert.ok(!r.data.reply.includes(b.legs[0].number)); // no e-mail -> no booking details
  r = await ask(`I want to cancel booking ${b.pnr}, my email is dhruv@example.com`);
  assert.equal(r.data.intent, 'cancel'); assert.ok(r.data.reply.includes(b.pnr)); assert.match(r.data.reply, /Rs [\d,]+/);
  assert.ok(r.data.actions.some((a) => a.href.startsWith('/confirmation.html?b=')));
  r = await ask(`status of ${b.legs[0].number}`);
  assert.equal(r.data.intent, 'status');
  r = await ask('is there a bus from Bengaluru airport?');
  assert.equal(r.data.intent, 'transfer'); assert.match(r.data.reply, /Vayu Vajra/);
  r = await ask('what about cabs?', { bookingToken: b.token });
  assert.match(r.data.reply, /BLR/);
  r = await ask('I need to talk to a human');
  assert.equal(r.data.handoff, true);
  assert.equal((await c.post('/api/assistant', { messages: 'x' })).status, 200);
});
