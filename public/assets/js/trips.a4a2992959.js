(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var form = $('#find-form');

  function tab(name) {
    $$('.trip-tab-btn').forEach(function (b) { var on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.className = 'trip-tab-btn px-4 py-2 font-semibold border-b-2 -mb-px ' + (on ? 'border-primary text-primary dark:text-sky-300 dark:border-sky-300' : 'border-transparent text-on-surface-variant dark:text-slate-300 hover:text-primary'); });
    $('#panel-mine').classList.toggle('hidden', name !== 'mine'); $('#panel-find').classList.toggle('hidden', name !== 'find');
  }
  $$('.trip-tab-btn').forEach(function (b) { b.addEventListener('click', function () { tab(b.dataset.tab); }); });
  tab(location.hash === '#find' ? 'find' : 'mine');

  function card(b) {
    var l0 = b.legs[0]; var last = b.legs[b.legs.length - 1];
    var route = b.tripType === 'multicity' ? b.legs.map(function (l) { return l.from; }).concat(last.to).join(' → ') : l0.from + (b.tripType === 'return' ? ' ⇄ ' : ' → ') + l0.to;
    var done = b.status === 'cancelled'; var past = b.legs[b.legs.length - 1].date < FC.todayISO();
    var chip = done ? '<span class="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 text-xs font-bold px-2 py-1 rounded-full">Cancelled</span>' : past ? '<span class="bg-slate-200 dark:bg-slate-700 text-xs font-bold px-2 py-1 rounded-full">Completed</span>' : '<span class="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 text-xs font-bold px-2 py-1 rounded-full">Confirmed</span>';
    return '<article class="bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
      '<div><div class="flex items-center gap-2 mb-1">' + chip + '<span class="font-mono font-bold tracking-widest text-sm">' + b.pnr + '</span></div><p class="font-bold text-lg">' + FC.esc(route) + '</p>' +
      '<p class="text-sm text-on-surface-variant dark:text-slate-300">' + FC.fmtDate(l0.date) + (b.tripType === 'return' ? ' - ' + FC.fmtShort(last.date) : '') + ' · ' + FC.plural(b.counts.adults + b.counts.children + b.counts.infants, 'passenger') + ' · ' + FC.money(b.pricing.total) + '</p></div>' +
      '<a href="/confirmation.html?b=' + encodeURIComponent(b.token) + '" class="text-center border border-primary text-primary dark:text-sky-300 dark:border-sky-300 font-bold px-5 py-2 rounded-lg hover:bg-primary/5 whitespace-nowrap">View' + (b.canCancel ? ' / cancel' : '') + '</a></article>';
  }
  function loadMine(user) {
    var list = $('#mine-list'); $('#mine-login').classList.toggle('hidden', !!user);
    if (!user) { list.innerHTML = ''; return; }
    list.innerHTML = '<div class="skeleton h-24"></div><div class="skeleton h-24"></div>';
    FC.api('GET', '/me/bookings').then(function (r) {
      list.innerHTML = r.bookings.length ? r.bookings.map(card).join('') : '<div class="text-center py-14 bg-surface-container-low dark:bg-slate-800 rounded-xl"><span class="material-symbols-outlined text-[48px] text-on-surface-variant" aria-hidden="true">flight_takeoff</span><p class="font-bold text-lg mt-2">No trips yet</p><p class="text-on-surface-variant dark:text-slate-300 mb-4">Your confirmed bookings will appear here.</p><a href="/" class="inline-block bg-primary text-on-primary font-bold px-6 py-3 rounded-lg">Search Flights</a></div>';
    }).catch(function (e) { list.innerHTML = '<p class="text-red-700">' + FC.esc(e.message) + '</p>'; });
  }
  FC.onAuth(loadMine);

  $('#find-pnr').addEventListener('input', function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var pnr = $('#find-pnr').value.trim(); var email = $('#find-email').value.trim(); var errs = {};
    if (!/^[A-Z0-9]{6}$/.test(pnr)) errs.pnr = 'A PNR has 6 letters or digits.';
    if (!/^\S+@\S+\.\S{2,}$/.test(email)) errs.email = 'Enter the e-mail used for the booking.';
    if (Object.keys(errs).length) { FC.applyErrors(form, errs); return; }
    FC.clearErrors(form); var btn = $('button[type=submit]', form); btn.disabled = true;
    FC.api('POST', '/bookings/lookup', { pnr: pnr, email: email }).then(function (r) { location.href = '/confirmation.html?b=' + encodeURIComponent(r.booking.token); })
      .catch(function (err) { btn.disabled = false; FC.setError(form, '_form', err.message); });
  });
})();
