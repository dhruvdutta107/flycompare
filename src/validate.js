'use strict';
const dates = require('./dates');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PHONE_RE = /^[6-9]\d{9}$/;           // Indian mobile numbers
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]{0,39}$/u;

class ValidationError extends Error {
  constructor(fields, message = 'Please fix the highlighted fields.') { super(message); this.status = 422; this.code = 'validation'; this.fields = fields; }
}
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function email(v) { const s = str(v, 320).toLowerCase(); return EMAIL_RE.test(s) ? s : null; }
function phone(v) { const s = str(v, 20).replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''); return PHONE_RE.test(s) ? s : null; }
function personName(v) { const s = str(v, 40).replace(/\s+/g, ' '); return NAME_RE.test(s) ? s : null; }

function ageOn(dob, onDate) {
  const [y, m, d] = dob.split('-').map(Number); const [Y, M, D] = onDate.split('-').map(Number);
  let age = Y - y; if (M < m || (M === m && D < d)) age--;
  return age;
}
const paxType = (i, { adults, children }) => (i < adults ? 'adult' : i < adults + children ? 'child' : 'infant');
const AGE_RULES = { adult: [12, 120, 'Adults must be 12 or older'], child: [2, 11, 'Children must be 2-11 years old'], infant: [0, 1, 'Infants must be under 2 years old'] };

/** Validate the passenger form. Returns { passengers, email, phone } or throws ValidationError with per-field messages. */
function passengers(body, counts, lastTravelDate) {
  const fields = {};
  const total = counts.adults + counts.children + counts.infants;
  const list = Array.isArray(body.passengers) ? body.passengers : [];
  if (list.length !== total) fields.passengers = `Expected details for ${total} passenger(s).`;
  const out = [];
  for (let i = 0; i < total; i++) {
    const p = list[i] || {}; const type = paxType(i, counts);
    const title = ['Mr', 'Ms', 'Mrs', 'Mstr', 'Miss'].includes(p.title) ? p.title : null;
    const first = personName(p.first); const last = personName(p.last);
    const dob = str(p.dob, 10);
    if (!title) fields[`p${i}.title`] = 'Choose a title.';
    if (!first) fields[`p${i}.first`] = 'Enter the first name as on the ID (letters only).';
    if (!last) fields[`p${i}.last`] = 'Enter the last name as on the ID (letters only).';
    if (!dates.isISODate(dob)) fields[`p${i}.dob`] = 'Enter a valid date of birth.';
    else {
      const [min, max, msg] = AGE_RULES[type]; const age = ageOn(dob, lastTravelDate);
      if (dob > dates.todayIST() || age < min || age > max) fields[`p${i}.dob`] = msg + ' on the travel date.';
    }
    out.push({ type, title, first, last, dob });
  }
  const em = email(body.email); const ph = phone(body.phone);
  if (!em) fields.email = 'Enter a valid e-mail address, like name@example.com.';
  if (!ph) fields.phone = 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  if (Object.keys(fields).length) throw new ValidationError(fields);
  return { passengers: out, email: em, phone: ph };
}

module.exports = { ValidationError, HttpError, str, email, phone, personName, passengers, EMAIL_RE };
