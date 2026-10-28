/* Step 4: e-ticket. The same view is used from My Trips (cancelled bookings show the refund). */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$;
  var token = FC.qs().get('b'); var booking = null; var reminders = []; var celebrated = false;
  FC.ctx.bookingToken = token; // lets the support chat answer about this booking
  function message(title, text) {
    var m = $('#state-msg'); m.classList.remove('hidden');
    m.innerHTML = '<span class="material-symbols-outlined text-[48px] text-on-surface-variant" aria-hidden="true">receipt_long</span><p class="font-headline-md text-headline-md font-bold mt-2">' + FC.esc(title) + '</p><p class="text-on-surface-variant dark:text-slate-300 mt-1 mb-4">' + FC.esc(text) + '</p><a href="/" class="inline-block bg-primary text-on-primary font-bold px-6 py-3 rounded-lg">Search Flights</a>';
  }
  if (!token) { message('No recent booking found', 'Search and book a flight to see your confirmation here.'); return; }
  load();

  function load() {
    FC.api('GET', '/bookings/' + encodeURIComponent(token)).then(function (r) {
      booking = r.booking;
      if (booking.status === 'held') { location.replace('/booking.html?b=' + encodeURIComponent(token)); return; }
      if (booking.status === 'expired') { message('This booking expired', 'The fare hold ended before payment was completed.'); return; }
      render();
    }).catch(function (e) { message('Booking not found', e.message); });
  }

  var detail = function (k, v) { return '<div class="flex justify-between gap-4"><span class="text-on-surface-variant dark:text-slate-300">' + k + '</span><span class="font-semibold text-right">' + v + '</span></div>'; };
  function render() {
    var b = booking; var cancelled = b.status === 'cancelled'; $('#conf-wrap').classList.remove('hidden');
    document.title = (cancelled ? 'Cancelled booking ' : 'Booking confirmed ') + b.pnr + ' - FlyCompare';
    if (cancelled) $('#stepper').classList.add('hidden');
    $('#conf-head').innerHTML = cancelled
      ? '<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 mb-4"><span class="material-symbols-outlined text-[40px]" aria-hidden="true">cancel</span></div><h1 class="font-headline-lg text-headline-lg">Booking cancelled</h1><p class="text-on-surface-variant dark:text-slate-300">A refund of <strong>' + FC.money(b.refund) + '</strong> is being returned to your original payment method (demo: no real money moves).</p>'
      : '<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 mb-4 pop-in"><svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="currentColor"/><path class="tick-draw" d="M12 20.5l5.5 5.5L28.5 14" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h1 class="font-headline-lg text-headline-lg">Booking Confirmed!</h1><p class="text-on-surface-variant dark:text-slate-300">Keep your PNR and <strong>' + FC.esc(b.contact.email) + '</strong> handy &mdash; together they let you retrieve this booking from My Trips on any device.</p>';

    var legs = b.legs.map(function (l, i) {
      var title = b.tripType === 'return' ? (i ? 'Return flight' : 'Outbound flight') : b.legs.length > 1 ? 'Flight ' + (i + 1) : 'Flight';
      var track = cancelled ? '' : '<a href="/track.html?id=' + encodeURIComponent(l.id) + '" class="no-print press inline-flex items-center gap-1 text-xs font-bold bg-white/15 hover:bg-white/25 rounded-full px-3 py-1"><span class="live-dot !w-1.5 !h-1.5 text-emerald-300" aria-hidden="true"></span>Track</a>';
      return '<section class="print-card bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl overflow-hidden shadow-sm"><div class="flex justify-between items-center gap-3 px-5 py-3 bg-primary text-white"><span class="font-bold">' + title + '</span><span class="flex items-center gap-3"><span class="text-sm">' + FC.fmtDate(l.date, true) + '</span>' + track + '</span></div>' +
        '<div class="p-5 flex items-center gap-4 sm:gap-8"><div><p class="text-3xl font-bold font-price-display">' + l.depart + '</p><p class="font-semibold">' + l.from + '</p></div>' +
        '<div class="flex-1 text-center text-xs text-on-surface-variant dark:text-slate-300"><p>' + l.duration + '</p><div class="h-[2px] bg-surface-variant dark:bg-slate-600 my-1"></div><p>' + FC.esc(l.stopsLabel) + '</p></div>' +
        '<div class="text-right"><p class="text-3xl font-bold font-price-display">' + l.arrive + (l.arrivalDayOffset ? '<sup class="text-xs text-red-600">+' + l.arrivalDayOffset + '</sup>' : '') + '</p><p class="font-semibold">' + l.to + '</p></div></div>' +
        '<div class="px-5 pb-5 text-sm space-y-1">' + detail('Airline', FC.esc(l.airline.name) + ' · ' + l.number) + detail('Cabin', FC.esc(l.cabin)) + detail('Baggage', 'Cabin ' + l.baggage.cabin + ' · Check-in ' + l.baggage.checkin) + '</div></section>';
    }).join('');

    var pax = '<section class="print-card bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-5 shadow-sm"><h2 class="font-headline-md text-headline-md font-bold mb-3">Passengers</h2><ul class="space-y-2 text-sm">' +
      b.passengers.map(function (p) { return '<li class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">person</span>' + FC.esc(p.title + ' ' + p.first + ' ' + p.last) + '<span class="text-xs text-on-surface-variant dark:text-slate-400 ml-auto capitalize">' + p.type + '</span></li>'; }).join('') + '</ul>' +
      '<p class="text-xs text-on-surface-variant dark:text-slate-400 mt-3">Contact: ' + FC.esc(b.contact.email) + ' · +91 ' + FC.esc(b.contact.phone) + '</p></section>';

    var p = b.pricing; var pay = b.payment;
    var how = pay ? (pay.method === 'card' ? FC.esc((pay.brand || 'Card') + ' ending ' + pay.last4) : pay.method === 'upi' ? 'UPI ' + FC.esc(pay.upi) : 'Net banking · ' + FC.esc(pay.bank)) : '';
    var fare = '<section class="print-card bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-5 shadow-sm"><h2 class="font-headline-md text-headline-md font-bold mb-3">Payment</h2><div class="space-y-2 text-sm">' +
      detail('Base fare', FC.money(p.base)) + detail('Taxes & fees', FC.money(p.taxes)) + (p.discount ? detail('Promo ' + FC.esc(p.promoCode), '- ' + FC.money(p.discount)) : '') +
      detail('Amount ' + (cancelled ? 'paid' : 'paid'), '<span class="text-primary dark:text-sky-300 font-bold">' + FC.money(p.total) + '</span>') + (pay ? detail('Paid with', how) + detail('Transaction', '<span class="font-mono text-xs">' + FC.esc(pay.txnId) + '</span>') : '') + (cancelled ? detail('Refund', '<span class="text-emerald-700 dark:text-emerald-300 font-bold">' + FC.money(b.refund) + '</span>') : '') + '</div></section>';

    $('#conf-ticket').innerHTML = '<section class="print-card bg-surface-container-lowest dark:bg-slate-800 border-2 ' + (cancelled ? 'border-red-300' : 'border-primary') + ' rounded-xl p-5 shadow-sm flex justify-between items-center"><div><p class="text-xs uppercase font-bold text-on-surface-variant dark:text-slate-400 tracking-wider">Booking reference (PNR)</p><p id="pnr" class="text-3xl sm:text-4xl font-bold font-mono tracking-[0.2em] ' + (cancelled ? 'line-through text-on-surface-variant' : 'text-primary dark:text-sky-300') + '">' + b.pnr + '</p></div><button type="button" id="copy-pnr" class="no-print flex items-center gap-1 text-sm font-semibold border border-surface-variant dark:border-slate-600 rounded-lg px-3 py-2 hover:border-primary"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">content_copy</span> Copy</button></section>' + legs + (cancelled ? '' : '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 no-print"><section id="reminders" class="scroll-mt-24 bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-5 shadow-sm"></section><section id="ground" class="bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-5 shadow-sm"><div class="skeleton h-40"></div></section></div>') + pax + fare;

    var actions = '<button type="button" id="print-btn" class="bg-primary text-on-primary font-bold px-6 py-3 rounded-lg flex items-center justify-center gap-2"><span class="material-symbols-outlined" aria-hidden="true">download</span> Download E-Ticket</button>' +
      '<a href="/" class="border border-primary text-primary dark:text-sky-300 dark:border-sky-300 font-bold px-6 py-3 rounded-lg text-center">Book Another Flight</a>';
    if (b.canCancel) actions += '<button type="button" id="cancel-btn" class="border border-red-300 text-red-700 dark:text-red-300 font-bold px-6 py-3 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30">Cancel booking</button>';
    $('#conf-actions').innerHTML = actions;
    $('#print-btn').addEventListener('click', function () { window.print(); });
    $('#copy-pnr').addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(b.pnr) : Promise.reject()).then(function () { FC.toast('PNR copied', 'success'); }, function () { FC.toast('Select the PNR and copy it manually.', 'info'); }); });
    var cb = $('#cancel-btn'); if (cb) cb.addEventListener('click', cancel);
    $('#conf-ticket').classList.add('stagger');
    if (!cancelled) { loadReminders(); loadGround(); celebrate(); }
    else FC.reminders.sync([], token);
    if (location.hash === '#reminders') setTimeout(function () { var r = $('#reminders'); if (r) { r.scrollIntoView({ behavior: FC.motion ? 'smooth' : 'auto' }); r.classList.add('flash'); } }, 400);
  }

  // ---------- celebration (only right after paying) ----------
  function celebrate() {
    if (celebrated || !FC.motion || !booking.confirmedAt) return; celebrated = true;
    var c = String(booking.confirmedAt); var at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(c) ? c : c.replace(' ', 'T') + 'Z');
    if (!(Date.now() - at < 3 * 60000)) return;
    var colors = ['#00677f', '#4cd6ff', '#ffba49', '#10b981', '#0074b6', '#f472b6'];
    for (var i = 0; i < 70; i++) {
      var c = document.createElement('span'); c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
      c.style.left = (Math.random() * 100) + 'vw'; c.style.background = colors[i % colors.length];
      c.style.setProperty('--x', (Math.random() * 200 - 100) + 'px'); c.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg'); c.style.setProperty('--t', (1.8 + Math.random() * 1.6) + 's');
      c.style.animationDelay = (Math.random() * 0.4) + 's';
      document.body.appendChild(c); setTimeout(c.remove.bind(c), 4200);
    }
  }

  // ---------- trip reminders ----------
  var depEpoch = function (l) { return Date.parse(l.date + 'T00:00:00+05:30') + l.departMin * 60000; };
  var istTime = function (ms) { return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); };
  var lead = function (m) { return m % 1440 === 0 ? (m / 1440) + (m > 1440 ? ' days' : ' day') : m >= 60 ? (m / 60) + ' h' : m + ' min'; };
  var legSel = 0;
  function loadReminders() {
    var firstFuture = booking.legs.findIndex(function (l) { return depEpoch(l) > Date.now(); }); legSel = firstFuture < 0 ? 0 : firstFuture;
    FC.api('GET', '/bookings/' + encodeURIComponent(token) + '/reminders', null, { quiet: true }).then(function (r) { reminders = r.reminders; FC.reminders.sync(reminders, token); paintReminders(); }, function () { paintReminders(); });
  }
  function paintReminders() {
    var box = $('#reminders'); if (!box) return;
    var leg = booking.legs[legSel]; var dep = depEpoch(leg);
    var mine = reminders.filter(function (r) { return r.legIndex === legSel; });
    var has = function (min) { return mine.filter(function (r) { return r.minutesBefore === min; })[0]; };
    function row(kind, min, icon, title) {
      var r = has(min); var at = dep - min * 60000; var past = at <= Date.now();
      return '<li class="flex items-center gap-3 py-2.5"><span class="w-9 h-9 shrink-0 rounded-lg bg-primary/10 text-primary dark:text-sky-300 flex items-center justify-center" aria-hidden="true"><span class="material-symbols-outlined text-[20px]">' + icon + '</span></span>' +
        '<span class="flex-1 min-w-0"><span class="block font-semibold text-sm" id="rl-' + kind + '">' + title + '</span><span class="block text-xs text-on-surface-variant dark:text-slate-400">' + (past ? 'Time has passed' : istTime(at)) + '</span></span>' +
        '<button type="button" role="switch" aria-checked="' + !!r + '" aria-labelledby="rl-' + kind + '" data-rem-kind="' + kind + '"' + (r ? ' data-rem-id="' + r.id + '"' : '') + (past && !r ? ' disabled' : '') + ' class="relative w-11 h-6 shrink-0 rounded-full transition-colors disabled:opacity-40 ' + (r ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600') + '"><span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ' + (r ? 'translate-x-5' : '') + '"></span></button></li>';
    }
    var custom = mine.filter(function (r) { return r.kind === 'custom'; });
    var opts = [[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [360, '6 hours'], [720, '12 hours'], [2880, '2 days']].filter(function (o) { return dep - o[0] * 60000 > Date.now() && !has(o[0]); });
    box.innerHTML = '<div class="flex items-start justify-between gap-2 mb-1"><h2 class="font-headline-md text-headline-md font-bold flex items-center gap-2"><span class="material-symbols-outlined text-primary dark:text-sky-300" aria-hidden="true">notifications_active</span>Trip reminders</h2><span id="notif-state"></span></div>' +
      (booking.legs.length > 1 ? '<label class="block text-xs font-semibold text-on-surface-variant dark:text-slate-400 mt-2">For flight <select id="rem-leg" class="ml-1 text-sm rounded-lg border-surface-variant dark:border-slate-600 bg-transparent py-1">' + booking.legs.map(function (l, i) { return '<option value="' + i + '"' + (i === legSel ? ' selected' : '') + '>' + l.number + ' ' + l.from + '→' + l.to + '</option>'; }).join('') + '</select></label>' : '') +
      '<ul class="divide-y divide-surface-variant dark:divide-slate-700">' + row('checkin', 1440, 'how_to_reg', 'Web check-in (24 h before)') + row('leave', 180, 'directions_car', 'Leave for the airport (3 h before)') +
      custom.map(function (r) { return '<li class="flex items-center gap-3 py-2.5 chat-msg"><span class="w-9 h-9 shrink-0 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center" aria-hidden="true"><span class="material-symbols-outlined text-[20px]">alarm</span></span><span class="flex-1 min-w-0"><span class="block font-semibold text-sm">' + lead(r.minutesBefore) + ' before</span><span class="block text-xs text-on-surface-variant dark:text-slate-400">' + istTime(r.remindAt) + '</span></span><button type="button" data-rem-del="' + r.id + '" class="p-2 rounded-lg text-on-surface-variant hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" aria-label="Remove reminder ' + lead(r.minutesBefore) + ' before"><span class="material-symbols-outlined text-[20px]" aria-hidden="true">delete</span></button></li>'; }).join('') + '</ul>' +
      (opts.length ? '<div class="flex items-center gap-2 mt-2"><label for="rem-custom" class="sr-only">Custom reminder</label><select id="rem-custom" class="flex-1 text-sm rounded-lg border-surface-variant dark:border-slate-600 bg-transparent py-2">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + ' before departure</option>'; }).join('') + '</select><button type="button" id="rem-add" class="shrink-0 inline-flex items-center gap-1 text-sm font-bold border border-primary text-primary dark:text-sky-300 dark:border-sky-300 rounded-lg px-3 py-2 hover:bg-primary/5"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">add_alarm</span>Add</button></div>' : '') +
      '<a href="/api/bookings/' + encodeURIComponent(token) + '/calendar.ics" download class="press mt-4 w-full inline-flex items-center justify-center gap-2 bg-primary text-white font-bold text-sm py-2.5 rounded-lg"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">event</span> Add to calendar (with alarms)</a>' +
      '<p class="text-[11px] text-on-surface-variant dark:text-slate-400 mt-2">Reminders pop up while FlyCompare is open in a tab. The calendar file alerts you on your phone even when it isn\'t.</p>';
    paintNotif();
  }
  function paintNotif(ask) {
    FC.reminders.permission(ask).then(function (p) {
      var el = $('#notif-state'); if (!el) return;
      el.innerHTML = p === 'granted' ? '<span class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>Alerts on</span>'
        : p === 'default' ? '<button type="button" id="notif-on" class="text-[11px] font-bold text-primary dark:text-sky-300 underline">Turn on alerts</button>'
          : p === 'denied' ? '<span class="text-[11px] text-on-surface-variant dark:text-slate-400" title="Allow notifications for this site in your browser settings">Alerts blocked</span>' : '';
    });
  }
  function remApi(method, url, body) {
    return FC.api(method, '/bookings/' + encodeURIComponent(token) + '/reminders' + (url || ''), body).then(function (r) { reminders = r.reminders; FC.reminders.sync(reminders, token); paintReminders(); return r; }, function (e) { FC.toast(e.message, 'error'); paintReminders(); });
  }
  document.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-rem-kind]');
    if (sw && !sw.disabled) {
      var on = sw.getAttribute('aria-checked') === 'true';
      if (!on) FC.reminders.permission(true).then(function () { paintNotif(); });
      sw.setAttribute('aria-checked', String(!on)); sw.disabled = true;
      if (on) remApi('DELETE', '/' + sw.getAttribute('data-rem-id'), {}).then(function () { FC.toast('Reminder removed', 'info'); });
      else remApi('POST', '', { kind: sw.getAttribute('data-rem-kind'), legIndex: legSel }).then(function (r) { if (r) FC.toast('Reminder set', 'success'); });
      return;
    }
    if (e.target.closest('#rem-add')) { FC.reminders.permission(true).then(function () { paintNotif(); }); remApi('POST', '', { kind: 'custom', minutesBefore: Number($('#rem-custom').value), legIndex: legSel }).then(function (r) { if (r) FC.toast('Reminder set', 'success'); }); return; }
    var del = e.target.closest('[data-rem-del]'); if (del) { remApi('DELETE', '/' + del.getAttribute('data-rem-del'), {}); return; }
    if (e.target.closest('#notif-on')) paintNotif(true);
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'rem-leg') { legSel = Number(e.target.value); paintReminders(); } });

  // ---------- getting into town from the arrival airport ----------
  function loadGround() {
    var leg = booking.legs[legSel] || booking.legs[0];
    var kerb = (leg.departMin + leg.durationMin + 25) % 1440;
    var hh = function (m) { return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60); };
    FC.api('GET', '/transfers?airport=' + leg.to + '&time=' + hh(kerb), null, { quiet: true }).then(function (r) {
      var t = r.best.transit; var c = r.best.cab;
      $('#ground').innerHTML = '<h2 class="font-headline-md text-headline-md font-bold flex items-center gap-2 mb-1"><span class="material-symbols-outlined text-amber-600" aria-hidden="true">local_taxi</span>Getting into ' + FC.esc(r.airport.label.split(' (')[0]) + '</h2>' +
        '<p class="text-xs text-on-surface-variant dark:text-slate-400 mb-3">You land at ' + leg.arrive + ' &middot; options around <strong>' + r.at + '</strong> to ' + FC.esc(r.destination.name) + '</p><ul class="space-y-2.5 text-sm">' +
        r.transit.slice(0, 2).map(function (x) { return '<li class="flex items-start gap-2"><span class="material-symbols-outlined text-[20px] ' + (x.available ? 'text-emerald-600' : 'text-amber-600') + '" aria-hidden="true">' + (x.type === 'metro' ? 'subway' : 'directions_bus') + '</span><span><strong>' + FC.esc(x.name) + '</strong><br><span class="text-on-surface-variant dark:text-slate-300">' + (x.available ? 'Running · next ' + x.next.slice(0, 2).join(', ') : 'Not running then · first at ' + x.firstService) + ' · Rs ' + x.fare[0] + '–' + x.fare[1] + '</span></span></li>'; }).join('') +
        (c ? '<li class="flex items-start gap-2"><span class="material-symbols-outlined text-[20px] text-emerald-600" aria-hidden="true">' + c.icon + '</span><span><strong>' + FC.esc(c.name) + '</strong><br><span class="text-on-surface-variant dark:text-slate-300">Rs ' + c.fare[0].toLocaleString('en-IN') + '–' + c.fare[1].toLocaleString('en-IN') + ' · ~' + c.durationMin + ' min drive</span></span></li>' : '') + '</ul>' +
        '<a href="/transfers.html?airport=' + r.airport.code + '&time=' + encodeURIComponent(r.at) + '" class="press mt-4 w-full inline-flex items-center justify-center gap-2 border border-primary text-primary dark:text-sky-300 dark:border-sky-300 font-bold text-sm py-2.5 rounded-lg hover:bg-primary/5">All cab &amp; bus options <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span></a>' +
        (t ? '' : '<p class="text-[11px] text-amber-700 dark:text-amber-300 mt-2">Late arrival: public transport may have stopped - a prepaid taxi is the safest choice.</p>');
    }, function () { var g = $('#ground'); if (g) g.innerHTML = '<p class="text-sm">Transfer options are unavailable right now. <a class="text-primary underline" href="/transfers.html?airport=' + leg.to + '">Try the transfers page</a>.</p>'; });
  }

  function cancel() {
    FC.confirm({ title: 'Cancel this booking?', danger: true, confirmText: 'Yes, cancel booking', cancelText: 'Keep booking',
      html: '<p>PNR <strong>' + FC.esc(booking.pnr) + '</strong> will be cancelled for all passengers.</p><ul class="list-disc pl-5 mt-2 space-y-1"><li>More than 24 hours before departure: full refund minus Rs 250 per passenger per flight.</li><li>Within 24 hours: 50% refund minus the same fee.</li></ul><p class="mt-2">This cannot be undone.</p>' }).then(function (yes) {
      if (!yes) return;
      FC.api('POST', '/bookings/' + encodeURIComponent(token) + '/cancel').then(function (r) { booking = r.booking; render(); window.scrollTo({ top: 0 }); FC.toast('Booking cancelled. Refund: ' + FC.money(booking.refund), 'success'); }).catch(function (e) { FC.toast(e.message, 'error'); });
    });
  }
})();
