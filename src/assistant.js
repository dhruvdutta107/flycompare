'use strict';
/**
 * Customer-service assistant ("FlyCompare Assistant").
 *
 * 1. Pulls facts out of the conversation: a PNR + e-mail pair (looked up exactly like "Find my booking", so nobody can
 *    read a booking without both), flight numbers (live status), airports + cab/bus questions (transfers).
 * 2. If ANTHROPIC_API_KEY is set, Claude writes the reply, grounded in those facts and the site's policies.
 * 3. Otherwise (or if the API is unreachable) a rule-based responder answers the same intents, so the widget always works.
 */
const config = require('./config');
const airports = require('./airports');
const dates = require('./dates');
const tracking = require('./tracking');
const transport = require('./transport');
const offers = require('./offers');

const POLICIES = `
- Fare hold: choosing flights locks the fare for 20 minutes while the traveller enters passenger details and pays.
- Cancellation: from My Trips or the e-ticket. More than 24 h before departure: full refund minus Rs 250 per passenger per flight. Within 24 h: 50% refund minus the same fee. Not possible after departure.
- Find a booking: My Trips > "Find a booking" with the 6-character PNR and the contact e-mail. Logged-in users see all bookings in My Trips.
- Baggage: Economy 7 kg cabin + 15 kg check-in; Premium Economy 7 kg + 20 kg; Business 10 kg + 35 kg.
- Infants (under 2) travel on an adult's lap, one per adult, flat Rs 1,100 per flight. Children are 2-11.
- Reminders: on the e-ticket page travellers can switch on a web check-in reminder (24 h before), a "leave for the airport" reminder (3 h before) or a custom one, and download a calendar (.ics) file with alarms.
- Live flight tracking: Track Flight page (flight number + date), or the "Track" button on the e-ticket.
- Airport transfers: Airport Transfers page lists app cabs, prepaid taxis and airport bus/metro with timings at the arrival time.
- Payments: card, UPI, net banking. This is a demo - no real money moves and fares/flights are simulated.
- Promo codes: ${offers.OFFERS.map((o) => `${o.code} (${o.description})`).join('; ')}.
- Human support: the contact form on the Help page creates a ticket; the assistant can also raise one.`;

const SYSTEM = `You are "FlyCompare Assistant", the customer-service agent for FlyCompare, an Indian domestic flight comparison and booking website (a student project with simulated fares).
Answer in a warm, concise way (max ~120 words, short paragraphs or "- " bullet lines, **bold** for key values). Prices are in Indian rupees, written "Rs 1,234". Times are IST.
Use ONLY the policies and FACTS below for anything specific (bookings, flight status, fares, transfers). Never invent PNRs, flight times, gates, refunds or prices. If you need a PNR and e-mail to look up a booking, ask for both. If you cannot help, offer to raise a ticket with a human agent.
Stay on travel / FlyCompare topics; politely decline anything else. Never ask for card numbers, CVV or passwords.
POLICIES:${POLICIES}`;

const PNR_CHARS = /^[A-HJ-NP-Z2-9]{6}$/;
const EMAIL_RE = /[^\s@<>()]{1,64}@[^\s@<>()]{1,255}\.[A-Za-z]{2,}/;
const FLIGHT_RE = /\b(6E|AI|QP|SG)\s?-?\s?(\d{3})\b/i;

function sanitize(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-12)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 800) }));
}

function findAirport(text) {
  const codes = text.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
  for (const c of codes) { const a = airports.get(c); if (a) return a; }
  const low = text.toLowerCase();
  const aliases = { bombay: 'BOM', delhi: 'DEL', bangalore: 'BLR', calcutta: 'CCU', madras: 'MAA', cochin: 'COK', trivandrum: 'TRV', vizag: 'VTZ' };
  for (const [k, v] of Object.entries(aliases)) if (low.includes(k)) return airports.get(v);
  return airports.AIRPORTS.find((a) => low.includes(a.city.toLowerCase())) || null;
}

/** Gather grounded facts from the conversation + page context. */
function gather(msgs, ctx, svc, now) {
  const userText = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const last = [...msgs].reverse().find((m) => m.role === 'user')?.content || '';
  const facts = {}; let booking = null;

  // booking: from the page the user is on (they already hold the token), or PNR + e-mail typed in chat
  if (ctx.bookingToken) { try { booking = svc.bookings.get(ctx.bookingToken); } catch { /* ignore */ } }
  const email = (userText.match(EMAIL_RE) || [])[0];
  if (!booking && email) {
    const words = userText.match(/\b[A-Za-z0-9]{6}\b/g) || [];
    for (const w of [...new Set(words.map((x) => x.toUpperCase()))]) {
      if (!PNR_CHARS.test(w)) continue;
      try { booking = svc.bookings.lookup(w, email); break; } catch { /* not this one */ }
    }
    if (!booking && words.some((w) => PNR_CHARS.test(w.toUpperCase()) && /\d/.test(w))) facts.bookingLookup = 'No booking matched that PNR and e-mail.';
  }
  if (booking && booking.status !== 'held') {
    const now2 = now;
    facts.booking = {
      pnr: booking.pnr, status: booking.status, tripType: booking.tripType, cabin: booking.cabin,
      passengers: booking.passengers.map((p) => `${p.title} ${p.first} ${p.last} (${p.type})`),
      legs: booking.legs.map((l) => ({ flight: l.number, airline: l.airline.name, from: l.from, to: l.to, date: l.date, departs: l.depart, arrives: l.arrive, flightId: l.id })),
      totalPaid: booking.pricing.total, refund: booking.refund, canCancel: booking.canCancel,
    };
    if (booking.status === 'confirmed' && booking.canCancel) {
      const mins = svc.bookings.minutesToDeparture(booking.legs[0], now2);
      const fee = Math.min(booking.pricing.total, 250 * (booking.counts.adults + booking.counts.children) * booking.legs.length);
      facts.booking.refundIfCancelledNow = mins > 1440 ? booking.pricing.total - fee : Math.max(0, Math.floor(booking.pricing.total / 2) - fee);
    }
    facts.bookingToken = booking.token;
  }

  // flight status: a flight number in the latest message, else the booked flight if the user asks about status
  const fm = last.match(FLIGHT_RE);
  const wantsStatus = /status|track|delay|late|on time|where is|landed|depart|gate|terminal|belt/i.test(last);
  if (fm) {
    const today = dates.todayIST(now);
    const dateHint = /tomorrow/i.test(last) ? dates.addDays(today, 1) : /yesterday/i.test(last) ? dates.addDays(today, -1) : today;
    const matches = tracking.findByNumber(`${fm[1]}${fm[2]}`, dateHint, now);
    facts.flightStatus = matches.length ? matches.slice(0, 3).map((m) => tracking.status(m.id, now)).map(slimStatus) : `No flight ${fm[1].toUpperCase()} ${fm[2]} found on ${dateHint}.`;
  } else if (wantsStatus && facts.booking) {
    const next = booking.legs.find((l) => l.date >= dates.todayIST(now)) || booking.legs[0];
    const s = tracking.status(next.id, now);
    if (s) facts.flightStatus = [slimStatus(s)];
  }

  // transfers
  if (/cab|taxi|uber|ola|bus|metro|transfer|transport|reach the city|from the airport|get to|auto/i.test(last)) {
    let a = findAirport(last);
    let at = dates.nowMinutesIST(now) + 20;
    if (!a && facts.booking) {
      const leg = booking.legs[0];
      a = airports.get(leg.to); at = leg.departMin + leg.durationMin + 25;
    }
    if (a) {
      const o = transport.options(a.code, at, now.getTime());
      facts.transfers = {
        airport: o.airport.label, atTime: o.at, to: o.destination.name, roadKm: o.roadKm,
        cabs: o.cabs.map((c) => ({ name: c.name, available: c.available, etaMin: c.etaMin, fare: `Rs ${c.fare[0]}-${c.fare[1]}`, minutes: c.durationMin })),
        publicTransport: o.transit.map((t) => ({ name: t.name, runningNow: t.available, hours: t.hours, next: t.next, fare: `Rs ${t.fare[0]}-${t.fare[1]}`, to: t.toWhere, firstService: t.firstService })),
        code: a.code,
      };
    } else facts.transfersNeedAirport = true;
  }
  return facts;
}

function slimStatus(s) {
  return {
    flight: s.number, airline: s.airline.name, route: `${s.from.city} (${s.from.code}) to ${s.to.city} (${s.to.code})`, date: s.date,
    status: s.phaseLabel, scheduledDeparture: s.times.scheduledDeparture, estimatedDeparture: s.times.estimatedDeparture,
    estimatedArrival: s.times.estimatedArrival, delayMin: s.delayMin, departureTerminal: s.from.terminal, gate: s.from.gate,
    arrivalBelt: s.to.belt, progressPct: Math.round(s.progress * 100), altitudeFt: s.position?.altitudeFt ?? null, id: s.id,
  };
}

// ---------- intents for chips/actions + the rule-based fallback ----------
const INTENTS = [
  ['human', /human|agent|person|representative|talk to (someone|support)|complain|ticket/i],
  ['cancel', /cancel|refund|money back/i],
  ['status', /status|track|delay|late|on time|where is|landed|gate|terminal|belt/i],
  ['transfer', /cab|taxi|uber|ola|bus|metro|transfer|transport|from the airport|reach the city/i],
  ['reminder', /remind|alert|notify|notification|calendar|check-?in/i],
  ['baggage', /bag|luggage|kg|weight/i],
  ['promo', /promo|coupon|offer|discount|code|deal/i],
  ['payment', /pay|upi|card|net ?banking|charged|deducted/i],
  ['booking', /pnr|booking|ticket|my trip|itinerary|find/i],
  ['infant', /infant|baby|child|kid/i],
  ['greet', /^(hi|hello|hey|namaste|good (morning|evening|afternoon))\b/i],
  ['thanks', /thank|thx|great|perfect|awesome/i],
];
const intentOf = (text) => (INTENTS.find(([, re]) => re.test(text)) || ['other'])[0];

function actionsFor(intent, facts) {
  const a = [];
  const tok = facts.bookingToken ? encodeURIComponent(facts.bookingToken) : null;
  if (facts.flightStatus && Array.isArray(facts.flightStatus)) a.push({ label: `Track ${facts.flightStatus[0].flight} live`, href: `/track.html?id=${encodeURIComponent(facts.flightStatus[0].id)}` });
  if (facts.transfers) a.push({ label: `Transfers at ${facts.transfers.code}`, href: `/transfers.html?airport=${facts.transfers.code}&time=${encodeURIComponent(facts.transfers.atTime)}` });
  if (tok && (intent === 'cancel' || intent === 'booking' || intent === 'reminder')) a.push({ label: 'Open e-ticket', href: `/confirmation.html?b=${tok}${intent === 'reminder' ? '#reminders' : ''}` });
  if (!tok && (intent === 'cancel' || intent === 'booking')) a.push({ label: 'Find my booking', href: '/trips.html#find' });
  if (intent === 'promo') a.push({ label: 'View offers', href: '/offers.html' });
  if (intent === 'status' && !facts.flightStatus) a.push({ label: 'Track a flight', href: '/track.html' });
  if (intent === 'transfer' && !facts.transfers) a.push({ label: 'Airport transfers', href: '/transfers.html' });
  return a.slice(0, 3);
}

function suggestionsFor(intent) {
  const all = ['Track my flight', 'Cab or bus from the airport', 'Cancellation & refund', 'Set a trip reminder', 'Baggage allowance', 'Talk to a human'];
  const skip = { status: 'Track my flight', transfer: 'Cab or bus from the airport', cancel: 'Cancellation & refund', reminder: 'Set a trip reminder', baggage: 'Baggage allowance', human: 'Talk to a human' }[intent];
  return all.filter((s) => s !== skip).slice(0, 4);
}

const money = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;

function ruleReply(intent, facts, last) {
  const b = facts.booking;
  const fsList = Array.isArray(facts.flightStatus) ? facts.flightStatus : null;
  const statusText = (s) => `**${s.flight}** ${s.route} on ${s.date}: **${s.status}**.\n- Departure ${s.estimatedDeparture}${s.delayMin >= 15 ? ` (was ${s.scheduledDeparture})` : ''} from ${s.departureTerminal}, gate ${s.gate}\n- Arrival ${s.estimatedArrival}${s.arrivalBelt ? ` · baggage belt ${s.arrivalBelt}` : ''}${s.progressPct > 0 && s.progressPct < 100 ? `\n- ${s.progressPct}% of the way there${s.altitudeFt ? ` at ${s.altitudeFt.toLocaleString('en-IN')} ft` : ''}` : ''}`;
  switch (intent) {
    case 'greet': return `Hi! I'm the FlyCompare Assistant. I can track a flight, find cabs or buses from the airport, explain refunds, set trip reminders or look up your booking (share your **PNR and e-mail**). What do you need?`;
    case 'thanks': return 'Happy to help! Anything else for your trip?';
    case 'status':
      if (fsList) return fsList.map(statusText).join('\n\n');
      if (typeof facts.flightStatus === 'string') return `${facts.flightStatus} Check the flight number (e.g. **6E 123**) and say "tomorrow" if it's not today.`;
      return 'Tell me the flight number (for example **6E 245** or **AI 101**), or your PNR and e-mail, and I\'ll pull up the live status.';
    case 'transfer': {
      const t = facts.transfers;
      if (!t) return 'Which airport are you arriving at? For example: "cab from BLR" or "bus from Delhi airport".';
      const cab = t.cabs.filter((c) => c.available).sort((x, y) => parseInt(x.fare.slice(3), 10) - parseInt(y.fare.slice(3), 10))[0];
      const pt = t.publicTransport;
      const lines = [`From **${t.airport}** to ${t.to} (~${t.roadKm} km) at **${t.atTime}**:`];
      if (cab) lines.push(`- **${cab.name}**: ${cab.fare}, ~${cab.minutes} min drive${cab.etaMin ? `, pickup in ~${cab.etaMin} min` : ''}`);
      pt.forEach((p) => lines.push(`- **${p.name}**: ${p.runningNow ? `running - next ${p.next.join(', ')}` : `not running then (first service ${p.firstService})`}, ${p.fare}`));
      lines.push('Timings are indicative - confirm at the arrivals help desk.');
      return lines.join('\n');
    }
    case 'cancel':
      if (b) {
        if (b.status === 'cancelled') return `Booking **${b.pnr}** is already cancelled. Refund: **${money(b.refund)}** to the original payment method.`;
        if (!b.canCancel) return `Booking **${b.pnr}** can no longer be cancelled because the trip has departed.`;
        return `If you cancel **${b.pnr}** now you'd get back about **${money(b.refundIfCancelledNow)}** of the ${money(b.totalPaid)} paid. Use **Cancel booking** on the e-ticket - you'll be asked to confirm first.`;
      }
      return 'You can cancel from My Trips or your e-ticket.\n- More than 24 h before departure: full refund minus **Rs 250** per passenger per flight\n- Within 24 h: **50%** refund minus the same fee\nShare your PNR and e-mail and I can work out your exact refund.';
    case 'reminder':
      return b ? `On your e-ticket for **${b.pnr}** you can switch on a web check-in reminder (24 h before), a "leave for the airport" reminder (3 h before) or a custom one - and add the trip to your calendar with alarms.`
        : 'Open your e-ticket (My Trips → View) and use **Trip reminders**: web check-in (24 h before), leave for the airport (3 h before) or a custom time. You can also download a calendar file with alarms.';
    case 'baggage': return 'Included baggage per passenger:\n- **Economy**: 7 kg cabin + 15 kg check-in\n- **Premium Economy**: 7 kg + 20 kg\n- **Business**: 10 kg + 35 kg\nInfants have no seat or check-in allowance.';
    case 'promo': return `Current codes:\n${offers.OFFERS.map((o) => `- **${o.code}**: ${o.description}`).join('\n')}\nEnter the code on the payment page.`;
    case 'payment': return 'We accept cards, UPI and net banking. If a payment fails, nothing is charged and your fare stays held until the timer runs out, so you can retry with another method. (Demo site: no real money moves.)';
    case 'infant': return 'Children aged 2-11 get their own seat. Infants under 2 travel on an adult\'s lap (one per adult) for a flat **Rs 1,100** per flight. Choose them in "Travellers & Class" on the search form.';
    case 'booking':
      if (b) return `Found it: **${b.pnr}** (${b.status}) - ${b.legs.map((l) => `${l.flight} ${l.from}→${l.to} on ${l.date} at ${l.departs}`).join('; ')}. Paid ${money(b.totalPaid)}.`;
      if (facts.bookingLookup) return `${facts.bookingLookup} Please check the 6-character PNR and the e-mail you used when booking.`;
      return 'Send me your **6-character PNR** and the **e-mail** used for the booking and I\'ll look it up. Logged-in? Your bookings are also in My Trips.';
    case 'human': return 'I can pass this to a human agent. Fill in the short form below and we\'ll reply by e-mail.';
    default:
      if (b) return `I found booking **${b.pnr}**. I can check its flight status, the refund if you cancel, or cabs at ${b.legs[0].to}. What would you like?`;
      if (/[a-z]/i.test(last) && last.length < 3) return 'Could you tell me a bit more?';
      return 'I can help with flight status, cabs and buses from the airport, cancellations and refunds, baggage, promo codes and reminders. What would you like to do?';
  }
}

async function callClaude(msgs, facts) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.aiModel, max_tokens: 500,
        system: `${SYSTEM}\n\nFACTS (from FlyCompare's systems, current time ${new Date().toISOString()}):\n${JSON.stringify(facts)}`,
        messages: msgs[0].role === 'user' ? msgs : msgs.slice(1),
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    if (!text) throw new Error('empty reply');
    return text.slice(0, 2000);
  } finally { clearTimeout(timer); }
}

/** @returns {Promise<{reply:string, suggestions:string[], actions:{label:string,href:string}[], intent:string, handoff:boolean, source:'ai'|'rules'}>} */
async function reply({ messages, context = {} }, svc, now = new Date()) {
  const msgs = sanitize(messages);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { reply: 'Please type a question.', suggestions: suggestionsFor('other'), actions: [], intent: 'other', handoff: false, source: 'rules' };
  const last = msgs[msgs.length - 1].content;
  const facts = gather(msgs, { bookingToken: typeof context.bookingToken === 'string' ? context.bookingToken : null }, svc, now);
  const intent = intentOf(last);
  let text; let source = 'rules';
  if (config.anthropicKey) {
    try { text = await callClaude(msgs, facts); source = 'ai'; } catch (e) { console.warn('[assistant] falling back to rules:', e.message); }
  }
  if (!text) text = ruleReply(intent, facts, last);
  return { reply: text, suggestions: suggestionsFor(intent), actions: actionsFor(intent, facts), intent, handoff: intent === 'human', source };
}

module.exports = { reply, gather, intentOf, sanitize };
