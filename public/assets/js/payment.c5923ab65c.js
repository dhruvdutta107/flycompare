/* Step 3: promo code, payment method, per-field validation, server-side charge (simulated gateway). */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var token = FC.qs().get('b'); var booking = null; var method = 'card'; var timerId = null;
  var form = $('#payment-form');

  function message(title, text, cta, href) {
    $('#payment-wrap').classList.add('hidden'); var m = $('#state-msg'); m.classList.remove('hidden');
    m.innerHTML = '<span class="material-symbols-outlined text-[48px] text-on-surface-variant" aria-hidden="true">event_busy</span><p class="font-headline-md text-headline-md font-bold mt-2">' + FC.esc(title) + '</p><p class="text-on-surface-variant dark:text-slate-300 mt-1 mb-4">' + FC.esc(text) + '</p><a href="' + href + '" class="inline-block bg-primary text-on-primary font-bold px-6 py-3 rounded-lg">' + FC.esc(cta) + '</a>';
  }
  if (!token) { message('Booking details missing', 'Please select a flight and enter passenger details first.', 'Search Flights', '/'); return; }
  var enc = encodeURIComponent(token);

  FC.api('GET', '/bookings/' + enc).then(function (r) {
    booking = r.booking;
    if (booking.status === 'confirmed' || booking.status === 'cancelled') { location.replace('/confirmation.html?b=' + enc); return; }
    if (booking.status === 'expired') { message('Your fare hold expired', 'Search again to get the latest price.', 'Search Flights', '/'); return; }
    if (!booking.passengers.length) { location.replace('/booking.html?b=' + enc); return; }
    init();
  }).catch(function (e) { message('Booking not found', e.message, 'Search Flights', '/'); });

  function init() {
    $('#payment-wrap').classList.remove('hidden'); FC.renderStepper();
    $('#back-link').href = '/booking.html?b=' + enc;
    FC.api('GET', '/payment-banks').then(function (r) { $('#bank').insertAdjacentHTML('beforeend', r.banks.map(function (b) { return '<option>' + FC.esc(b) + '</option>'; }).join('')); });
    setMethod('card'); renderFare(); startTimer();
    var saved = FC.store.get('fc_promo', null);
    if (booking.pricing.promoCode) $('#promo-input').value = booking.pricing.promoCode;
    else if (saved && saved.code) { $('#promo-input').value = saved.code; applyPromo(saved.code, true); }
  }

  // ---------- fare + promo ----------
  function renderFare() {
    var p = booking.pricing; var c = booking.counts;
    var rows = '<div class="flex justify-between"><span class="text-on-surface-variant dark:text-slate-300">Base fare (' + FC.plural(c.adults + c.children + c.infants, 'passenger') + ')</span><span>' + FC.money(p.base) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-on-surface-variant dark:text-slate-300">Taxes &amp; fees</span><span>' + FC.money(p.taxes) + '</span></div>' +
      (p.discount ? '<div class="flex justify-between text-emerald-700 dark:text-emerald-300 font-semibold"><span>Promo ' + FC.esc(p.promoCode) + ' <button type="button" id="promo-remove" class="underline text-xs ml-1 font-normal">remove</button></span><span>- ' + FC.money(p.discount) + '</span></div>' : '') +
      '<div class="border-t border-surface-variant dark:border-slate-700 pt-3 mt-2 flex justify-between items-center"><span class="font-bold">Total payable</span><span class="text-xl font-bold text-primary dark:text-sky-300 font-price-display">' + FC.money(p.total) + '</span></div>' +
      '<div class="pt-2 text-xs text-on-surface-variant dark:text-slate-400 space-y-1">' + booking.legs.map(function (l) { return '<p>' + l.from + ' → ' + l.to + ' · ' + FC.fmtShort(l.date) + ' · ' + FC.esc(l.airline.name) + ' ' + l.number + '</p>'; }).join('') +
      '<p>Lead passenger: ' + FC.esc(booking.passengers[0].title + ' ' + booking.passengers[0].first + ' ' + booking.passengers[0].last) + '</p></div>';
    $('#fare-summary').innerHTML = rows; $('#pay-btn-text').textContent = 'Pay ' + FC.money(p.total) + ' & Confirm';
    var rm = $('#promo-remove'); if (rm) rm.addEventListener('click', function () { applyPromo('', false); });
  }
  function applyPromo(code, silent) {
    FC.setError(document, 'promo', ''); $('#promo-ok').classList.add('hidden');
    return FC.api('POST', '/bookings/' + enc + '/promo', { code: code }).then(function (r) {
      booking = r.booking; renderFare();
      if (code) { $('#promo-ok').textContent = r.message; $('#promo-ok').classList.remove('hidden'); if (!silent) FC.toast(r.message, 'success'); FC.store.set('fc_promo', { code: booking.pricing.promoCode }); }
      else { $('#promo-input').value = ''; FC.store.del('fc_promo'); FC.toast('Promo code removed', 'info'); }
    }).catch(function (e) { FC.setError(document, 'promo', e.message); if (silent) FC.store.del('fc_promo'); });
  }
  $('#promo-btn').addEventListener('click', function () { var v = $('#promo-input').value.trim(); if (!v) { FC.setError(document, 'promo', 'Enter a promo code first.'); return; } applyPromo(v, false); });
  $('#promo-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#promo-btn').click(); } });

  // ---------- method tabs ----------
  function setMethod(m) {
    method = m;
    $$('.pay-tab').forEach(function (b) {
      var on = b.dataset.m === m; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      b.className = 'pay-tab border-2 rounded-lg p-3 flex flex-col items-center gap-1 transition-colors ' + (on ? 'border-primary bg-primary/5 text-primary dark:text-sky-300' : 'border-surface-variant dark:border-slate-600 hover:border-primary');
    });
    $$('.pay-panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== 'pay-' + m); });
    $('#pay-error').classList.add('hidden'); FC.clearErrors(form);
  }
  $('#pay-method-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-m]'); if (b) setMethod(b.dataset.m); });
  $('#pay-method-tabs').addEventListener('keydown', function (e) {
    var order = ['card', 'upi', 'netbanking']; var i = order.indexOf(method);
    if (e.key === 'ArrowRight') i = (i + 1) % 3; else if (e.key === 'ArrowLeft') i = (i + 2) % 3; else return;
    setMethod(order[i]); $('#tab-' + order[i]).focus(); e.preventDefault();
  });

  // ---------- input formatting (Lab 8: group card digits, auto-insert expiry slash) ----------
  var num = $('#cardNumber'); var exp = $('#expiry'); var cvv = $('#cvv');
  function brand(d) { return /^4/.test(d) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(d) ? 'Mastercard' : /^3[47]/.test(d) ? 'Amex' : /^(60|65|81|82|508)/.test(d) ? 'RuPay' : ''; }
  num.addEventListener('input', function () {
    var d = num.value.replace(/\D/g, '').slice(0, 19); var b = brand(d); $('#card-brand').textContent = b;
    var parts = b === 'Amex' ? [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)] : d.match(/.{1,4}/g) || [];
    num.value = parts.filter(Boolean).join(' '); cvv.maxLength = b === 'Amex' ? 4 : 3;
  });
  exp.addEventListener('input', function (e) {
    var d = exp.value.replace(/\D/g, '').slice(0, 4);
    if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2); else if (d.length === 2 && e.inputType !== 'deleteContentBackward') d += '/';
    exp.value = d;
  });
  cvv.addEventListener('input', function () { cvv.value = cvv.value.replace(/\D/g, ''); });
  function luhn(s) { var sum = 0; var alt = false; for (var i = s.length - 1; i >= 0; i--) { var n = Number(s[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; }
  function check(name) {
    var v = (form.elements[name] ? form.elements[name].value : '').trim();
    if (name === 'cardNumber') { var d = v.replace(/\s/g, ''); return !d ? 'Enter your card number.' : d.length < 13 ? 'Card numbers have at least 13 digits - you entered ' + d.length + '.' : !luhn(d) ? 'This card number looks incorrect. Please check each digit.' : ''; }
    if (name === 'expiry') {
      var m = /^(\d{2})\/(\d{2})$/.exec(v); if (!m) return 'Use the format MM/YY, for example 08/29.';
      var mm = +m[1]; var yy = 2000 + +m[2]; var now = new Date(); if (mm < 1 || mm > 12) return 'Month must be between 01 and 12.';
      return yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1) ? 'This card has expired.' : '';
    }
    if (name === 'cvv') { var need = brand(num.value.replace(/\s/g, '')) === 'Amex' ? 4 : 3; return new RegExp('^\\d{' + need + '}$').test(v) ? '' : 'Enter the ' + need + '-digit security code.'; }
    if (name === 'cardName') return v.length < 2 ? 'Enter the name as printed on the card.' : '';
    if (name === 'upiId') return /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}$/.test(v) ? '' : 'Enter a valid UPI ID, like name@okbank.';
    if (name === 'bank') return v ? '' : 'Please choose your bank.';
    return '';
  }
  var FIELDS = { card: ['cardNumber', 'expiry', 'cvv', 'cardName'], upi: ['upiId'], netbanking: ['bank'] };
  form.addEventListener('focusout', function (e) { var n = e.target.name; if (n && check(n) !== undefined && FIELDS[method].indexOf(n) >= 0) FC.setError(form, n, check(n)); });
  form.addEventListener('input', function (e) { var n = e.target.name; if (n && e.target.getAttribute('aria-invalid')) FC.setError(form, n, check(n)); $('#pay-error').classList.add('hidden'); });
  $('#fill-test').addEventListener('click', function () {
    setMethod('card'); num.value = '4111 1111 1111 1111'; num.dispatchEvent(new Event('input')); exp.value = '12/35'; cvv.value = '123'; $('#cardName').value = (booking.passengers[0].first + ' ' + booking.passengers[0].last).toUpperCase(); FC.clearErrors(form);
  });

  // ---------- submit ----------
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var errs = {};
    FIELDS[method].forEach(function (n) { var m = check(n); if (m) errs[n] = m; });
    if (Object.keys(errs).length) { FC.applyErrors(form, errs); return; }
    FC.clearErrors(form); $('#pay-error').classList.add('hidden');
    var body = { method: method }; FIELDS[method].forEach(function (n) { body[n] = form.elements[n].value; });
    var btn = $('#pay-btn'); btn.disabled = true; $('#pay-btn-loader').classList.remove('hidden'); var label = $('#pay-btn-text').textContent; $('#pay-btn-text').textContent = 'Processing payment...';
    FC.api('POST', '/bookings/' + enc + '/pay', body).then(function () {
      FC.store.del('fc_promo'); location.href = '/confirmation.html?b=' + enc;
    }).catch(function (err) {
      btn.disabled = false; $('#pay-btn-loader').classList.add('hidden'); $('#pay-btn-text').textContent = label;
      if (err.status === 410) { message('Your fare hold expired', err.message, 'Search Flights', '/'); return; }
      if (err.fields) { FC.applyErrors(form, err.fields); return; }
      var box = $('#pay-error'); $('#pay-error-text').textContent = err.message; box.classList.remove('hidden'); box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (err.code === 'promo_invalid') applyPromo('', true);
    });
  });

  function startTimer() {
    var left = booking.holdSecondsLeft; var t = $('#hold-timer');
    function tick() { var m = Math.floor(left / 60); t.textContent = m + ':' + String(left % 60).padStart(2, '0'); if (left <= 0) { clearInterval(timerId); message('Your fare hold expired', 'Search again to get the latest price.', 'Search Flights', '/'); } left--; }
    tick(); timerId = setInterval(tick, 1000);
  }
})();
