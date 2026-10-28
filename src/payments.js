'use strict';
/**
 * SIMULATED payment gateway. No money moves and nothing leaves this process.
 * The card number / CVV / UPI id are validated and then discarded - only brand + last4 (or a masked UPI id)
 * is kept, which is what a real integration (Razorpay / Stripe / PayU) would also hand back.
 *
 * Test inputs
 *   Card 4111 1111 1111 1111 (any future expiry, any 3-digit CVV)  -> success
 *   Any card number ending 0002                                      -> declined by bank
 *   Any card number ending 9995                                      -> insufficient funds
 *   UPI id containing "fail"                                         -> declined
 *
 * To go live, replace `charge()` with a call to your gateway and verify its webhook signature.
 */
const crypto = require('node:crypto');
const { ValidationError } = require('./validate');

const BANKS = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Punjab National Bank', 'Kotak Mahindra Bank'];

function luhn(num) {
  let sum = 0; let alt = false;
  for (let i = num.length - 1; i >= 0; i--) { let n = Number(num[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
function brand(num) {
  if (/^4/.test(num)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
  if (/^3[47]/.test(num)) return 'Amex';
  if (/^(60|65|81|82|508)/.test(num)) return 'RuPay';
  return 'Card';
}

function validate(method, body, now = new Date()) {
  const fields = {};
  if (method === 'card') {
    const number = String(body.cardNumber || '').replace(/[\s-]/g, '');
    const expiry = String(body.expiry || '').trim();
    const cvv = String(body.cvv || '').trim();
    const name = String(body.cardName || '').trim();
    if (!/^\d{13,19}$/.test(number)) fields.cardNumber = 'Enter the 13-19 digit number printed on your card.';
    else if (!luhn(number)) fields.cardNumber = 'This card number looks incorrect. Please check each digit.';
    const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
    if (!m) fields.expiry = 'Use the format MM/YY, for example 08/29.';
    else {
      const mm = Number(m[1]); const yy = 2000 + Number(m[2]);
      if (mm < 1 || mm > 12) fields.expiry = 'Month must be between 01 and 12.';
      else if (yy < now.getUTCFullYear() || (yy === now.getUTCFullYear() && mm < now.getUTCMonth() + 1)) fields.expiry = 'This card has expired.';
    }
    const cvvLen = brand(number) === 'Amex' ? 4 : 3;
    if (!new RegExp(`^\\d{${cvvLen}}$`).test(cvv)) fields.cvv = `Enter the ${cvvLen}-digit security code.`;
    if (!/^[\p{L}][\p{L}\p{M} .'-]{1,59}$/u.test(name)) fields.cardName = 'Enter the name as printed on the card.';
    if (Object.keys(fields).length) throw new ValidationError(fields);
    return { method, number, brand: brand(number), last4: number.slice(-4) };
  }
  if (method === 'upi') {
    const vpa = String(body.upiId || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,64}@[a-z]{2,32}$/.test(vpa)) throw new ValidationError({ upiId: 'Enter a valid UPI ID, like name@okbank.' });
    return { method, vpa };
  }
  if (method === 'netbanking') {
    const bank = String(body.bank || '');
    if (!BANKS.includes(bank)) throw new ValidationError({ bank: 'Please choose your bank.' });
    return { method, bank };
  }
  throw new ValidationError({ method: 'Choose a payment method.' });
}

function charge(instrument, amount) {
  const txn = 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase();
  if (instrument.method === 'card') {
    if (instrument.last4 === '0002') return { ok: false, error: 'Your bank declined this card. Try another card or a different payment method.' };
    if (instrument.last4 === '9995') return { ok: false, error: 'Insufficient funds on this card. Try another payment method.' };
  }
  if (instrument.method === 'upi' && instrument.vpa.includes('fail')) return { ok: false, error: 'The UPI request was declined. Check your UPI app or try another method.' };
  const record = { method: instrument.method, txnId: txn, amount, paidAt: new Date().toISOString() };
  if (instrument.method === 'card') Object.assign(record, { brand: instrument.brand, last4: instrument.last4 });
  if (instrument.method === 'upi') record.upi = instrument.vpa.replace(/^(.).*(@.*)$/, '$1***$2');
  if (instrument.method === 'netbanking') record.bank = instrument.bank;
  return { ok: true, record };
}

module.exports = { BANKS, validate, charge, luhn };
