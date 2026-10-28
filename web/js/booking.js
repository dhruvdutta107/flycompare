/* Step 2: passenger + contact details with live validation. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var token = FC.qs().get('b'); var booking = null; var timerId = null;
  var form = $('#passenger-form');
  var NAME_RE = /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'-]{0,39}$/;

  function message(title, text, cta, href) {
    $('#booking-wrap').classList.add('hidden'); var m = $('#state-msg'); m.classList.remove('hidden');
    m.innerHTML = '<span class="material-symbols-outlined text-[48px] text-on-surface-variant" aria-hidden="true">event_busy</span><p class="font-headline-md text-headline-md font-bold mt-2">' + FC.esc(title) + '</p><p class="text-on-surface-variant dark:text-slate-300 mt-1 mb-4">' + FC.esc(text) + '</p><a href="' + href + '" class="inline-block bg-primary text-on-primary font-bold px-6 py-3 rounded-lg">' + FC.esc(cta) + '</a>';
  }
  if (!token) { message('No flight selected', 'Please search and choose a flight before entering passenger details.', 'Search Flights', '/'); return; }

  FC.api('GET', '/bookings/' + encodeURIComponent(token)).then(function (r) {
    booking = r.booking;
    if (booking.status === 'confirmed' || booking.status === 'cancelled') { location.replace('/confirmation.html?b=' + encodeURIComponent(token)); return; }
    if (booking.status === 'expired') { message('Your fare hold expired', 'Fares can change, so we release them after ' + 20 + ' minutes. Search again to get the latest price.', 'Search Flights', '/'); return; }
    init();
  }).catch(function (e) { message(e.status === 404 ? 'Booking not found' : 'Something went wrong', e.message, 'Search Flights', '/'); });

  var typeLabel = { adult: 'Adult', child: 'Child', infant: 'Infant' };
  function dobRange(type) {
    var last = booking.legs[booking.legs.length - 1].date; var d = new Date(last + 'T00:00:00'); var y = d.getFullYear();
    function shift(n) { var x = new Date(d); x.setFullYear(y - n); return x.toLocaleDateString('en-CA'); }
    if (type === 'adult') return { min: shift(120), max: shift(12) };
    if (type === 'child') { var minD = new Date(d); minD.setFullYear(y - 12); minD.setDate(minD.getDate() + 1); return { min: minD.toLocaleDateString('en-CA'), max: shift(2) }; }
    var m = new Date(d); m.setFullYear(y - 2); m.setDate(m.getDate() + 1); return { min: m.toLocaleDateString('en-CA'), max: FC.todayISO() };
  }
  function init() {
    $('#booking-wrap').classList.remove('hidden');
    var qs = new URLSearchParams(); qs.set('b', token);
    $('#stepper').setAttribute('data-links', '/'); FC.renderStepper();
    $('#back-link').href = '/'; $('#back-link').textContent = ''; $('#back-link').innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">arrow_back</span> Back to search';
    renderSummary(); renderFields(); startTimer();
    FC.onAuth(function (u) { var em = $('#contact-email'); if (u && !em.value) em.value = u.email; });
  }

  function renderFields() {
    var c = booking.counts; var types = [];
    for (var i = 0; i < c.adults; i++) types.push('adult'); for (i = 0; i < c.children; i++) types.push('child'); for (i = 0; i < c.infants; i++) types.push('infant');
    var saved = booking.passengers || [];
    $('#passenger-fields').innerHTML = types.map(function (t, i) {
      var s = saved[i] || {}; var r = dobRange(t); var n = types.slice(0, i + 1).filter(function (x) { return x === t; }).length;
      var cls = 'w-full border border-surface-variant dark:border-slate-600 rounded-lg px-3 py-2.5 bg-transparent focus:border-primary';
      return '<fieldset class="mb-6 pb-6 border-b border-surface-variant dark:border-slate-700 last:border-0"><legend class="font-semibold text-sm text-on-surface-variant dark:text-slate-300 mb-3">' + typeLabel[t] + ' ' + n + (t === 'child' ? ' (2-11 years)' : t === 'infant' ? ' (under 2 years)' : '') + '</legend>' +
        '<div class="grid grid-cols-1 sm:grid-cols-6 gap-3">' +
        '<div class="sm:col-span-1"><label class="block text-xs font-semibold mb-1" for="p' + i + '-title">Title</label><select id="p' + i + '-title" data-field="p' + i + '.title" data-pax="' + i + '" class="' + cls + '">' + (t === 'adult' ? ['Mr', 'Ms', 'Mrs'] : ['Mstr', 'Miss']).map(function (o) { return '<option' + (s.title === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select><p class="field-msg" data-msg="p' + i + '.title" hidden></p></div>' +
        '<div class="sm:col-span-2"><label class="block text-xs font-semibold mb-1" for="p' + i + '-first">First name</label><input id="p' + i + '-first" data-field="p' + i + '.first" data-kind="name" autocomplete="' + (i === 0 ? 'given-name' : 'off') + '" value="' + FC.esc(s.first || '') + '" placeholder="As on ID" class="' + cls + '"/><p class="field-msg" data-msg="p' + i + '.first" hidden></p></div>' +
        '<div class="sm:col-span-2"><label class="block text-xs font-semibold mb-1" for="p' + i + '-last">Last name</label><input id="p' + i + '-last" data-field="p' + i + '.last" data-kind="name" autocomplete="' + (i === 0 ? 'family-name' : 'off') + '" value="' + FC.esc(s.last || '') + '" placeholder="As on ID" class="' + cls + '"/><p class="field-msg" data-msg="p' + i + '.last" hidden></p></div>' +
        '<div class="sm:col-span-1"><label class="block text-xs font-semibold mb-1" for="p' + i + '-dob">Date of birth</label><input id="p' + i + '-dob" type="date" data-field="p' + i + '.dob" data-kind="dob" min="' + r.min + '" max="' + r.max + '" value="' + FC.esc(s.dob || '') + '" class="' + cls + '"/><p class="field-msg" data-msg="p' + i + '.dob" hidden></p></div></div></fieldset>';
    }).join('');
    if (booking.contact) { $('#contact-email').value = booking.contact.email; $('#contact-phone').value = booking.contact.phone; }
  }

  // ---------- validation (client mirrors server rules, shows message next to the field as you type) ----------
  function check(el) {
    var v = el.value.trim(); var key = el.getAttribute('data-field') || el.name; var kind = el.getAttribute('data-kind');
    if (kind === 'name') return !v ? 'Enter the ' + (key.endsWith('first') ? 'first' : 'last') + ' name as on the ID.' : !NAME_RE.test(v) ? 'Use letters only (no digits or symbols).' : '';
    if (kind === 'dob') { if (!v) return 'Enter the date of birth.'; if (el.min && v < el.min) return 'This date is too early for this passenger type.'; if (el.max && v > el.max) return 'This passenger type needs a different age on the travel date.'; return ''; }
    if (key === 'email') return !v ? 'Enter your e-mail address.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? 'That e-mail looks incomplete. Example: name@example.com' : '';
    if (key === 'phone') return !v ? 'Enter your 10-digit mobile number.' : !/^\d+$/.test(v) ? 'Use digits only.' : v.length !== 10 ? 'A mobile number has 10 digits - you entered ' + v.length + '.' : !/^[6-9]/.test(v) ? 'Indian mobile numbers start with 6, 7, 8 or 9.' : '';
    return '';
  }
  form.addEventListener('focusout', function (e) { var el = e.target; if (el.matches('input[data-field], input[name]')) { var m = check(el); FC.setError(form, el.getAttribute('data-field') || el.name, m); if (!m && el.value) el.classList.add('input-ok'); else el.classList.remove('input-ok'); } });
  form.addEventListener('input', function (e) {
    var el = e.target; var key = el.getAttribute('data-field') || el.name;
    if (el.name === 'phone') el.value = el.value.replace(/\D/g, '').slice(0, 10);
    if (el.classList.contains('input-error') || el.getAttribute('aria-invalid')) FC.setError(form, key, check(el));
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault(); var errs = {};
    $$('input[data-field], #contact-email, #contact-phone', form).forEach(function (el) { var m = check(el); if (m) errs[el.getAttribute('data-field') || el.name] = m; });
    if (Object.keys(errs).length) { FC.applyErrors(form, errs); FC.toast('Please fix ' + FC.plural(Object.keys(errs).length, 'highlighted field') + ' before continuing.', 'error'); return; }
    var pax = []; var n = booking.counts.adults + booking.counts.children + booking.counts.infants;
    for (var i = 0; i < n; i++) pax.push({ title: $('#p' + i + '-title').value, first: $('#p' + i + '-first').value.trim(), last: $('#p' + i + '-last').value.trim(), dob: $('#p' + i + '-dob').value });
    var btn = $('#continue-pay'); btn.disabled = true; $('#continue-pay-text').textContent = 'Saving...';
    FC.api('PUT', '/bookings/' + encodeURIComponent(token) + '/passengers', { passengers: pax, email: $('#contact-email').value.trim(), phone: $('#contact-phone').value }).then(function () {
      location.href = '/payment.html?b=' + encodeURIComponent(token);
    }).catch(function (err) {
      btn.disabled = false; $('#continue-pay-text').textContent = 'Continue to Payment';
      if (err.status === 410) { message('Your fare hold expired', err.message, 'Search Flights', '/'); return; }
      if (err.fields) { FC.applyErrors(form, err.fields); FC.toast(err.message, 'error'); } else FC.setError(form, '_form', err.message);
    });
  });

  // ---------- summary + hold timer ----------
  function renderSummary() {
    var b = booking; var legs = b.legs.map(function (l, i) {
      return '<div class="border border-surface-variant dark:border-slate-700 rounded-lg p-3"><p class="text-[11px] font-bold uppercase text-on-surface-variant dark:text-slate-400 mb-1">' + (b.tripType === 'return' ? (i ? 'Return' : 'Outbound') : 'Flight ' + (i + 1)) + ' · ' + FC.fmtDate(l.date) + '</p>' +
        '<p class="font-bold">' + l.from + ' → ' + l.to + '</p><p class="text-xs text-on-surface-variant dark:text-slate-300">' + FC.esc(l.airline.name) + ' ' + l.number + ' · ' + l.depart + ' - ' + l.arrive + (l.arrivalDayOffset ? ' (+' + l.arrivalDayOffset + ')' : '') + ' · ' + FC.esc(l.stopsLabel) + '</p></div>';
    }).join('');
    var c = b.counts; var rows = [['Passengers', FC.plural(c.adults, 'adult') + (c.children ? ', ' + FC.plural(c.children, 'child', 'children') : '') + (c.infants ? ', ' + FC.plural(c.infants, 'infant') : '')], ['Cabin', b.cabin]];
    $('#trip-summary').innerHTML = legs + '<dl class="space-y-2">' + rows.map(function (r) { return '<div class="flex justify-between gap-3"><dt class="text-on-surface-variant dark:text-slate-300">' + r[0] + '</dt><dd class="font-semibold text-right">' + FC.esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<div class="border-t border-surface-variant dark:border-slate-700 pt-3 flex justify-between items-center"><span class="font-bold">Total fare</span><span class="text-xl font-bold text-primary dark:text-sky-300 font-price-display">' + FC.money(b.pricing.gross) + '</span></div>' +
      '<div class="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">lock_clock</span><span>Fare locked for <strong id="hold-timer">--:--</strong></span></div>';
  }
  function startTimer() {
    var left = booking.holdSecondsLeft; var t = $('#hold-timer');
    function tick() {
      if (!t) return; var m = Math.floor(left / 60); var s = left % 60; t.textContent = m + ':' + String(s).padStart(2, '0');
      if (left <= 0) { clearInterval(timerId); message('Your fare hold expired', 'Fares can change, so we release them after 20 minutes. Search again to get the latest price.', 'Search Flights', '/'); } left--;
    }
    tick(); timerId = setInterval(tick, 1000);
  }
})();
