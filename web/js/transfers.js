/* Airport transfers: cabs + public transport available at the traveller's kerb time; cab availability refreshes live. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$;
  var form = $('#tr-form'); var ap = $('#tr-airport'); var time = $('#tr-time');
  var live = null; var lastKey = '';

  function nowIST(plus) {
    var d = new Date(Date.now() + (plus || 0) * 60000);
    var s = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    var p = s.split(':').map(Number); var m = Math.ceil((p[0] * 60 + p[1]) / 5) * 5 % 1440;
    return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60);
  }
  time.value = nowIST(20);
  $('#tr-now').addEventListener('click', function () { time.value = nowIST(20); if (ap.dataset.code) go(); });
  FC.airportInput(ap, function () { go(); });

  var QUICK = [['BOM', 'Mumbai'], ['DEL', 'New Delhi'], ['BLR', 'Bengaluru'], ['HYD', 'Hyderabad'], ['MAA', 'Chennai'], ['CCU', 'Kolkata'], ['GOI', 'Goa'], ['COK', 'Kochi']];
  $('#tr-quick').innerHTML = QUICK.map(function (q) { return '<button type="button" data-q="' + q[0] + '" data-label="' + q[1] + ' (' + q[0] + ')" class="text-sm font-semibold bg-white/80 dark:bg-slate-800 border border-surface-variant dark:border-slate-600 rounded-full px-3 py-1.5 hover:border-primary hover:text-primary">' + q[1] + ' <span class="text-on-surface-variant dark:text-slate-400 font-normal">' + q[0] + '</span></button>'; }).join('');
  $('#tr-quick').addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (!b) return; ap.value = b.dataset.label; ap.dataset.code = b.dataset.q; FC.setError(form, 'airport', ''); go(); });

  form.addEventListener('submit', function (e) { e.preventDefault(); go(); });

  function go(quiet) {
    var errs = {};
    if (!ap.dataset.code && !ap.value.trim()) errs.airport = 'Choose the airport you are arriving at.';
    if (!/^\d{2}:\d{2}$/.test(time.value)) errs.time = 'Enter a time like 14:30.';
    if (Object.keys(errs).length) { FC.applyErrors(form, errs); return; }
    FC.clearErrors(form);
    var code = ap.dataset.code || ap.value.trim();
    var key = code + '|' + time.value;
    FC.api('GET', '/transfers?airport=' + encodeURIComponent(code) + '&time=' + encodeURIComponent(time.value), null, { quiet: !!quiet }).then(function (r) {
      if (!ap.dataset.code) { ap.value = r.airport.label; ap.dataset.code = r.airport.code; }
      history.replaceState(null, '', '?airport=' + r.airport.code + '&time=' + encodeURIComponent(time.value));
      render(r, quiet && key === lastKey); lastKey = key;
      clearInterval(live); live = setInterval(function () { if (!document.hidden) go(true); }, 60000);
    }, function (err) { if (err.fields) FC.applyErrors(form, err.fields); else if (!quiet) FC.toast(err.message, 'error'); });
  }

  var money = function (f) { return 'Rs ' + f[0].toLocaleString('en-IN') + ' – ' + f[1].toLocaleString('en-IN'); };
  var mins = function (m) { return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; };

  function cabCard(c, links) {
    var badge = !c.available ? '<span class="text-xs font-bold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-full px-2 py-0.5">None nearby</span>'
      : c.etaMin ? '<span class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-900/40 rounded-full px-2 py-0.5"><span class="live-dot !w-1.5 !h-1.5" aria-hidden="true"></span>' + (c.prepaid || c.key === 'prepaid' ? 'Counter open' : c.etaMin + ' min away') + '</span>' : '';
    return '<article class="lift border border-surface-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-4 flex gap-4 ' + (c.available ? '' : 'opacity-70') + '" data-cab="' + c.key + '">' +
      '<span class="w-12 h-12 shrink-0 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center" aria-hidden="true"><span class="material-symbols-outlined">' + c.icon + '</span></span>' +
      '<div class="flex-1 min-w-0"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-bold">' + FC.esc(c.name) + '</h3>' + badge + '</div>' +
      '<p class="text-sm text-on-surface-variant dark:text-slate-300 mt-0.5">' + c.seats + ' seats · ~' + mins(c.durationMin) + ' drive' + (c.nearby ? ' · ' + c.nearby + ' cabs nearby' : '') + '</p>' +
      '<div class="flex flex-wrap items-end justify-between gap-2 mt-2"><p><span class="font-price-display text-lg font-bold text-primary dark:text-sky-300">' + money(c.fare) + '</span>' + (c.surge ? ' <span class="text-xs font-bold text-amber-700 dark:text-amber-300">· ' + c.surge + 'x demand</span>' : '') + '</p>' +
      (c.key === 'prepaid' ? '' : '<a href="' + FC.esc(links.uber) + '" target="_blank" rel="noopener noreferrer" class="press inline-flex items-center gap-1 text-sm font-bold text-primary dark:text-sky-300 hover:underline">Book in app <span class="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span></a>') + '</div>' +
      (c.note ? '<p class="text-xs text-on-surface-variant dark:text-slate-400 mt-2">' + FC.esc(c.note) + '</p>' : '') + '</div></article>';
  }
  function transitCard(t, at) {
    var icon = t.type === 'metro' ? 'subway' : t.type === 'train' ? 'train' : 'directions_bus';
    var status = t.available
      ? '<span class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-900/40 rounded-full px-2 py-0.5"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">check_circle</span>Running at ' + at + '</span>'
      : '<span class="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 rounded-full px-2 py-0.5"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">nightlight</span>Not running · first at ' + t.firstService + '</span>';
    return '<article class="lift border border-surface-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-4 flex gap-4">' +
      '<span class="w-12 h-12 shrink-0 rounded-xl ' + (t.type === 'metro' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300') + ' flex items-center justify-center" aria-hidden="true"><span class="material-symbols-outlined">' + icon + '</span></span>' +
      '<div class="flex-1 min-w-0"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-bold">' + FC.esc(t.name) + '</h3>' + status + '</div>' +
      '<p class="text-sm text-on-surface-variant dark:text-slate-300 mt-0.5">To ' + FC.esc(t.toWhere) + (t.durationMin ? ' · ~' + mins(t.durationMin) : '') + ' · ' + FC.esc(t.hours) + ', every ~' + t.every + ' min</p>' +
      (t.next.length ? '<div class="flex flex-wrap items-center gap-1.5 mt-2"><span class="text-xs text-on-surface-variant dark:text-slate-400">Next:</span>' + t.next.map(function (n, i) { return '<span class="text-xs font-bold rounded-md px-2 py-1 ' + (i ? 'bg-surface-container-high dark:bg-slate-700' : 'bg-primary text-white') + '">' + n + '</span>'; }).join('') + '</div>' : '') +
      '<p class="mt-2"><span class="font-price-display text-lg font-bold text-primary dark:text-sky-300">' + money(t.fare) + '</span> <span class="text-xs text-on-surface-variant dark:text-slate-400">per person</span></p>' +
      (t.note ? '<p class="text-xs text-on-surface-variant dark:text-slate-400 mt-1">' + FC.esc(t.note) + '</p>' : '') + '</div></article>';
  }

  function render(r, refresh) {
    $('#tr-empty').classList.add('hidden'); var box = $('#tr-results'); box.classList.remove('hidden');
    var bestCab = r.best.cab; var bestT = r.best.transit;
    var rec = bestT && bestT.next.length
      ? '<strong>' + FC.esc(bestT.name) + '</strong> is the cheapest way in (' + money(bestT.fare) + '). Short on time or carrying lots of bags? ' + (bestCab ? 'A <strong>' + FC.esc(bestCab.name.replace('App cab - ', '').toLowerCase()) + '</strong> costs about ' + money(bestCab.fare) + '.' : 'Take a prepaid taxi.')
      : bestCab ? 'Public transport isn\'t running at ' + r.at + ', so a cab is your best bet: <strong>' + FC.esc(bestCab.name) + '</strong> for about ' + money(bestCab.fare) + '.' : 'Use the prepaid taxi counter in arrivals.';
    var html = '<div class="flex flex-wrap items-end justify-between gap-3 mb-5 slide-up"><div><h2 class="font-headline-md text-headline-md font-bold">' + FC.esc(r.airport.label) + ' → ' + FC.esc(r.destination.name) + '</h2>' +
      '<p class="text-sm text-on-surface-variant dark:text-slate-300">About ' + r.roadKm + ' km by road · options at <strong>' + r.at + ' IST</strong></p></div>' +
      '<a href="' + FC.esc(r.links.directions) + '" target="_blank" rel="noopener noreferrer" class="press inline-flex items-center gap-1.5 border border-primary text-primary dark:text-sky-300 dark:border-sky-300 font-bold text-sm px-4 py-2 rounded-lg hover:bg-primary/5"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">map</span> Directions in Maps</a></div>' +
      '<div class="rounded-xl bg-primary/5 dark:bg-sky-400/10 border border-primary/20 dark:border-sky-300/20 p-4 mb-6 flex gap-3 slide-up"><span class="material-symbols-outlined text-primary dark:text-sky-300 icon-fill" aria-hidden="true">tips_and_updates</span><p class="text-sm">' + rec + '</p></div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter">' +
      '<div><h3 class="font-bold flex items-center gap-2 mb-3"><span class="material-symbols-outlined text-amber-600" aria-hidden="true">local_taxi</span> Cabs &amp; taxis <span class="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><span class="live-dot !w-1.5 !h-1.5" aria-hidden="true"></span>Live</span></h3><div class="space-y-3' + (refresh ? '' : ' stagger') + '" id="tr-cabs">' + r.cabs.map(function (c) { return cabCard(c, r.links); }).join('') + '</div></div>' +
      '<div><h3 class="font-bold flex items-center gap-2 mb-3"><span class="material-symbols-outlined text-sky-600" aria-hidden="true">directions_bus</span> Bus &amp; metro</h3><div class="space-y-3' + (refresh ? '' : ' stagger') + '">' + r.transit.map(function (t) { return transitCard(t, r.at); }).join('') + '</div></div>' +
      '</div><p class="text-xs text-on-surface-variant dark:text-slate-400 mt-6">Fares and timings are indicative and cab availability is simulated for this demo. Always confirm at the airport help desk. "Book in app" opens your cab app with the airport and ' + FC.esc(r.destination.name) + ' filled in.</p>';
    var prev = refresh ? Array.prototype.map.call(document.querySelectorAll('[data-cab]'), function (el) { return el.textContent; }) : [];
    box.innerHTML = html;
    if (refresh) document.querySelectorAll('[data-cab]').forEach(function (el, i) { if (prev[i] && prev[i] !== el.textContent) el.classList.add('flash'); });
  }

  var q = FC.qs();
  if (q.get('time') && /^\d{2}:\d{2}$/.test(q.get('time'))) time.value = q.get('time');
  if (q.get('airport')) { ap.value = q.get('airport'); go(); }
})();
