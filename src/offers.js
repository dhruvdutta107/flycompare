'use strict';
const dates = require('./dates');

/**
 * Promo codes. `check(ctx)` returns an error string if the code does not apply, otherwise null.
 * ctx = { legs, gross, base, email, userId, hasPriorBooking }
 */
const OFFERS = [
  {
    code: 'SUMMER40', icon: 'wb_sunny', tag: 'Domestic Flights', headline: '40% OFF',
    description: 'Up to 40% off the base fare on all domestic routes (max discount Rs 2,000, minimum fare Rs 2,000).',
    type: 'percent', value: 40, cap: 2000,
    check: (c) => (c.base < 2000 ? 'SUMMER40 needs a base fare of at least Rs 2,000.' : null),
  },
  {
    code: 'NEWUSER500', icon: 'person_add', tag: 'First Booking', headline: 'Rs 500 OFF',
    description: 'Flat Rs 500 off for first-time FlyCompare travellers (minimum fare Rs 1,500).',
    type: 'flat', value: 500,
    check: (c) => (c.hasPriorBooking ? 'NEWUSER500 is only valid on your first booking.' : c.gross < 1500 ? 'NEWUSER500 needs a fare of at least Rs 1,500.' : null),
  },
  {
    code: 'WEEKEND750', icon: 'weekend', tag: 'Weekend Getaway', headline: 'Rs 750 OFF',
    description: 'Flat Rs 750 off Friday-Sunday departures to Goa, Leh and Bengaluru (minimum fare Rs 2,500).',
    type: 'flat', value: 750,
    check: (c) => {
      const ok = c.legs.some((l) => [5, 6, 0].includes(dates.weekday(l.date)) && ['GOI', 'IXL', 'BLR'].includes(l.to));
      if (!ok) return 'WEEKEND750 applies to Fri-Sun departures to Goa, Leh or Bengaluru.';
      return c.gross < 2500 ? 'WEEKEND750 needs a fare of at least Rs 2,500.' : null;
    },
  },
];

const publicShape = ({ code, icon, tag, headline, description }) => ({ code, icon, tag, headline, description });
const find = (code) => OFFERS.find((o) => o.code === String(code || '').trim().toUpperCase());

/** @returns {{ok:true, code:string, discount:number}|{ok:false, error:string}} */
function apply(code, ctx) {
  const o = find(code);
  if (!o) return { ok: false, error: 'That promo code is not valid.' };
  const err = o.check(ctx);
  if (err) return { ok: false, error: err };
  let discount = o.type === 'percent' ? Math.round((ctx.base * o.value) / 100) : o.value;
  if (o.cap) discount = Math.min(discount, o.cap);
  discount = Math.max(0, Math.min(discount, ctx.gross - 1));
  return { ok: true, code: o.code, discount };
}

module.exports = { OFFERS, find, apply, publicShape };
