/* Live flight tracker: search by flight number, "in the air now" board, animated map + status that refreshes every 15 s. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var form = $('#track-form'); var numInput = $('#trk-number');
  var POLL = 15000;
  var current = null; var timer = null; var tick = null; var lastPhase = null; var lastUpdate = 0; var airportsAll = [];
  var map = null; // { id, svg, plane, flown, scale }

  // ---------- date chips (yesterday / today / tomorrow) ----------
  var today = FC.todayISO(); var day = today;
  var DAYS = [[FC.addDays(today, -1), 'Yesterday'], [today, 'Today'], [FC.addDays(today, 1), 'Tomorrow']];
  function paintDays() {
    $('#trk-days').innerHTML = DAYS.map(function (d) {
      var on = d[0] === day;
      return '<button type="button" data-day="' + d[0] + '" aria-pressed="' + on + '" class="rounded-md text-sm font-semibold transition-all ' + (on ? 'bg-white dark:bg-slate-700 shadow text-primary dark:text-sky-300' : 'text-on-surface-variant dark:text-slate-300 hover:text-primary') + '"><span class="block leading-tight">' + d[1] + '</span><span class="block text-[10px] font-normal opacity-75">' + FC.fmtShort(d[0]) + '</span></button>';
    }).join('');
  }
  $('#trk-days').addEventListener('click', function (e) { var b = e.target.closest('[data-day]'); if (b) { day = b.dataset.day; paintDays(); } });
  paintDays();

  numInput.addEventListener('input', function () { numInput.value = numInput.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ''); FC.setError(form, 'number', ''); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var n = numInput.value.trim();
    if (!/^(6E|AI|QP|SG)\s*-?\s*\d{3}$/i.test(n)) { FC.applyErrors(form, { number: 'Enter an airline code and 3 digits, e.g. 6E 245 (IndiGo), AI 101 (Air India), QP 123 (Akasa) or SG 456 (SpiceJet).' }); return; }
    search(n, day);
  });

  function search(number, date) {
    var icon = $('[data-trk-icon]'); icon.textContent = 'progress_activity'; icon.classList.add('spin');
    FC.api('GET', '/track/search?number=' + encodeURIComponent(number) + '&date=' + date).then(function (r) {
      var box = $('#trk-matches');
      if (!r.flights.length) { box.classList.add('hidden'); FC.applyErrors(form, { number: 'No flight ' + number.toUpperCase() + ' on ' + FC.fmtDate(date) + '. Check the number or try another day.' }); return; }
      if (r.flights.length === 1) { box.classList.add('hidden'); load(r.flights[0].id, true); return; }
      box.classList.remove('hidden');
      box.innerHTML = '<p class="font-semibold mb-3">' + r.flights.length + ' flights use the number ' + FC.esc(r.flights[0].number) + ' on ' + FC.fmtDate(date) + '. Which one?</p><div class="grid sm:grid-cols-2 gap-3 stagger">' +
        r.flights.map(function (f) { return '<button type="button" data-load="' + FC.esc(f.id) + '" class="lift text-left border border-surface-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-4 hover:border-primary"><span class="block font-bold">' + FC.esc(f.fromCity) + ' → ' + FC.esc(f.toCity) + '</span><span class="block text-sm text-on-surface-variant dark:text-slate-300">' + f.depart + ' – ' + f.arrive + ' · ' + FC.esc(f.phaseLabel) + '</span></button>'; }).join('') + '</div>';
    }).catch(function (err) { if (err.fields) FC.applyErrors(form, err.fields); else FC.toast(err.message, 'error'); })
      .then(function () { icon.textContent = 'radar'; icon.classList.remove('spin'); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-load]'); if (!b) return;
    e.preventDefault(); load(b.getAttribute('data-load'), true);
    if (window.innerWidth < 1024) $('#trk-main').scrollIntoView({ behavior: FC.motion ? 'smooth' : 'auto', block: 'start' });
  });

  // ---------- geometry ----------
  var R = Math.PI / 180; var K = Math.cos(22 * R) * 20;
  function proj(lat, lon) { return [(lon - 68) * K, (37.5 - lat) * 20]; }
  function gc(a, b, n) {
    var p1 = a.lat * R; var l1 = a.lon * R; var p2 = b.lat * R; var l2 = b.lon * R;
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2)));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var f = i / n; if (!d) { out.push([a.lat, a.lon]); continue; }
      var A = Math.sin((1 - f) * d) / Math.sin(d); var B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2); var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2); var z = A * Math.sin(p1) + B * Math.sin(p2);
      out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / R, Math.atan2(y, x) / R]);
    }
    return out;
  }
  var pathOf = function (pts) { return pts.map(function (p, i) { var q = proj(p[0], p[1]); return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '); };
  var PLANE = 'M0 -12 L2 -4 L11 1 L11 3 L2 0.5 L1.5 7 L4.5 9.5 L4.5 11 L0 9.8 L-4.5 11 L-4.5 9.5 L-1.5 7 L-2 0.5 L-11 3 L-11 1 L-2 -4 Z';

  // ---------- formatting ----------
  var istHHMM = function (ms) { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }); };
  function dur(min) { min = Math.max(0, Math.round(min)); var h = Math.floor(min / 60); var m = min % 60; return h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + ' min'; }
  var STEPS = [['checkin', 'Check-in', 'how_to_reg'], ['boarding', 'Boarding', 'door_open'], ['departed', 'Take-off', 'flight_takeoff'], ['en_route', 'In the air', 'flight'], ['landed', 'Landed', 'flight_land'], ['arrived', 'At the gate', 'where_to_vote']];
  var ORDER = { scheduled: -1, checkin: 0, boarding: 1, gate_closed: 1, departed: 2, en_route: 3, at_stop: 3, landed: 4, arrived: 5 };
  function pill(s) {
    var air = ['departed', 'en_route', 'at_stop'].indexOf(s.phase) >= 0; var done = s.phase === 'landed' || s.phase === 'arrived';
    var late = s.delayMin >= 15 && ORDER[s.phase] < 2;
    var cls = late ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : air || done ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : s.phase === 'scheduled' ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200';
    var icon = air ? '<span class="live-dot" aria-hidden="true"></span>' : '<span class="material-symbols-outlined text-[16px]" aria-hidden="true">' + (done ? 'check_circle' : late ? 'schedule' : 'radio_button_checked') + '</span>';
    return '<span class="inline-flex items-center gap-1.5 text-sm font-bold rounded-full px-3 py-1 ' + cls + '">' + icon + FC.esc(s.phaseLabel) + '</span>';
  }
  function timeCell(label, sched, est, delayed) {
    return '<p class="text-[11px] uppercase tracking-wider font-bold text-on-surface-variant dark:text-slate-400">' + label + '</p><p class="font-price-display text-2xl sm:text-3xl font-bold ' + (delayed ? 'text-amber-600 dark:text-amber-300' : '') + '">' + est + '</p>' + (delayed ? '<p class="text-xs text-on-surface-variant dark:text-slate-400 line-through">' + sched + '</p>' : '<p class="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">On time</p>');
  }

  // ---------- detail ----------
  function load(id, push) {
    clearTimeout(timer);
    if (push) history.replaceState(null, '', '?id=' + encodeURIComponent(id));
    if (!current || current.id !== id) { $('#trk-detail').innerHTML = '<div class="skeleton h-[520px] rounded-2xl"></div>'; $('#trk-detail').classList.remove('hidden'); $('#trk-empty').classList.add('hidden'); map = null; lastPhase = null; }
    fetchStatus(id);
  }
  function fetchStatus(id) {
    FC.api('GET', '/track/' + encodeURIComponent(id), null, { quiet: !!current && current.id === id }).then(function (r) {
      var s = r.flight; var first = !current || current.id !== s.id;
      if (!first && lastPhase && lastPhase !== s.phase) { FC.toast(s.number + ': ' + s.phaseLabel, 'info'); announce(s.number + ' is now ' + s.phaseLabel); }
      current = s; lastPhase = s.phase; lastUpdate = Date.now();
      if (first) build(s); update(s, first);
      document.title = s.number + ' ' + s.from.code + '→' + s.to.code + ': ' + s.phaseLabel + ' - FlyCompare';
      schedule();
    }).catch(function (e) {
      if (!current || current.id !== id) { $('#trk-detail').innerHTML = '<div class="text-center py-14 bg-surface-container-low dark:bg-slate-800 rounded-2xl"><span class="material-symbols-outlined text-[48px] text-on-surface-variant" aria-hidden="true">error</span><p class="font-bold mt-2">' + FC.esc(e.message) + '</p></div>'; return; }
      schedule(); // transient error during polling: keep the last good view and retry
    });
  }
  function schedule() { clearTimeout(timer); if (!document.hidden && current) timer = setTimeout(function () { fetchStatus(current.id); }, POLL); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && current) fetchStatus(current.id); else clearTimeout(timer); });
  function announce(t) { var a = $('#trk-announce'); if (a) { a.textContent = ''; setTimeout(function () { a.textContent = t; }, 50); } }

  function build(s) {
    var arrAt = istHHMM(s.times.arrivalEpoch + 25 * 60000);
    $('#trk-detail').innerHTML =
      '<div class="bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden slide-up">' +
      '<div class="p-5 sm:p-6">' +
        '<div class="flex flex-wrap items-start justify-between gap-3 mb-5"><div class="flex items-center gap-3">' +
          '<span class="w-11 h-11 rounded-xl text-white font-bold flex items-center justify-center ' + (FC.airline[s.airline.code] || 'bg-slate-600') + '" aria-hidden="true">' + s.airline.code + '</span>' +
          '<div><h2 class="font-headline-md text-headline-md font-bold leading-tight">' + FC.esc(s.number) + ' <span class="text-on-surface-variant dark:text-slate-400 font-normal text-base">' + FC.esc(s.airline.name) + '</span></h2>' +
          '<p class="text-sm text-on-surface-variant dark:text-slate-300">' + FC.fmtDate(s.date) + ' · ' + FC.esc(s.stopsLabel) + ' · ' + s.duration + '</p></div></div>' +
          '<div data-u="pill"></div></div>' +
        '<div class="grid grid-cols-[1fr_auto_1fr] sm:grid-cols-[1fr_2fr_1fr] items-center gap-3 sm:gap-6">' +
          '<div><p class="font-price-display text-3xl sm:text-4xl font-bold text-primary dark:text-sky-300">' + s.from.code + '</p><p class="text-sm font-semibold truncate">' + FC.esc(s.from.city) + '</p></div>' +
          '<div class="relative h-10" aria-hidden="true"><div class="absolute top-1/2 inset-x-0 h-1 -mt-0.5 rounded-full bg-surface-variant dark:bg-slate-600"></div><div data-u="fill" class="track-progress-fill absolute top-1/2 left-0 h-1 -mt-0.5 rounded-full bg-gradient-to-r from-primary to-sky-400" style="width:0"></div>' +
            '<span data-u="pplane" class="track-progress-plane absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white dark:bg-slate-900 border-2 border-primary dark:border-sky-300 text-primary dark:text-sky-300 flex items-center justify-center shadow" style="left:0"><span class="material-symbols-outlined icon-fill text-[18px] rotate-90">flight</span></span></div>' +
          '<div class="text-right"><p class="font-price-display text-3xl sm:text-4xl font-bold text-primary dark:text-sky-300">' + s.to.code + '</p><p class="text-sm font-semibold truncate">' + FC.esc(s.to.city) + '</p></div>' +
        '</div>' +
        '<p data-u="progresstext" class="text-center text-sm font-semibold text-on-surface-variant dark:text-slate-300 mt-1 min-h-[20px]"></p>' +
      '</div>' +
      '<div class="relative bg-gradient-to-br from-[#0b1f2a] via-[#0f2a3a] to-[#082032] text-white">' +
        '<svg data-u="map" class="block w-full h-[280px] sm:h-[340px]" role="img" aria-label="Map of the route from ' + FC.esc(s.from.city) + ' to ' + FC.esc(s.to.city) + ' with the aircraft position"></svg>' +
        '<div class="absolute left-3 bottom-3 right-3 flex flex-wrap gap-2 text-xs" data-u="chips"></div>' +
        '<span class="absolute top-3 right-3 text-[10px] uppercase tracking-wider bg-white/10 rounded-full px-2 py-1">Schematic &middot; simulated</span>' +
      '</div>' +
      '<div class="grid grid-cols-2 border-t border-surface-variant dark:border-slate-700 divide-x divide-surface-variant dark:divide-slate-700">' +
        '<div class="p-5" data-u="dep"></div><div class="p-5 text-right" data-u="arr"></div></div>' +
      '<div class="px-5 sm:px-6 py-5 border-t border-surface-variant dark:border-slate-700"><ol data-u="timeline" class="grid grid-cols-6 gap-1" aria-label="Flight progress"></ol></div>' +
      '<div class="px-5 sm:px-6 py-4 border-t border-surface-variant dark:border-slate-700 flex flex-wrap items-center gap-2 bg-surface-container-low/60 dark:bg-slate-900/40">' +
        '<a href="/transfers.html?airport=' + s.to.code + '&time=' + encodeURIComponent(arrAt) + '" class="press inline-flex items-center gap-1.5 bg-primary text-white font-bold text-sm px-4 py-2 rounded-lg"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">local_taxi</span> Cab &amp; bus at ' + s.to.code + '</a>' +
        '<button type="button" data-u="copy" class="inline-flex items-center gap-1.5 border border-surface-variant dark:border-slate-600 font-semibold text-sm px-4 py-2 rounded-lg hover:border-primary"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">link</span> Copy link</button>' +
        '<button type="button" data-open-chat="Status of ' + FC.esc(s.number) + '" class="inline-flex items-center gap-1.5 border border-surface-variant dark:border-slate-600 font-semibold text-sm px-4 py-2 rounded-lg hover:border-primary"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">support_agent</span> Ask assistant</button>' +
        '<span class="ml-auto text-xs text-on-surface-variant dark:text-slate-400 flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">sync</span><span data-u="updated">Updated just now</span></span>' +
      '</div></div><p id="trk-announce" class="sr-only" aria-live="polite"></p>';
    $('[data-u="copy"]').addEventListener('click', function () {
      var url = location.origin + '/track.html?id=' + encodeURIComponent(s.id);
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { FC.toast('Tracking link copied', 'success'); }, function () { FC.toast(url, 'info', { duration: 8000 }); });
    });
    buildMap(s);
    clearInterval(tick);
    tick = setInterval(function () { var el = $('[data-u="updated"]'); if (!el) return; var sec = Math.round((Date.now() - lastUpdate) / 1000); el.textContent = sec < 5 ? 'Updated just now' : 'Updated ' + sec + 's ago'; }, 1000);
  }

  function buildMap(s) {
    var svg = $('[data-u="map"]'); var segs = [];
    for (var i = 0; i < s.route.length - 1; i++) segs.push(gc(s.route[i], s.route[i + 1], 48));
    var pts = [].concat.apply([], segs).map(function (p) { return proj(p[0], p[1]); });
    var xs = pts.map(function (p) { return p[0]; }); var ys = pts.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs); var maxX = Math.max.apply(null, xs); var minY = Math.min.apply(null, ys); var maxY = Math.max.apply(null, ys);
    var w = Math.max(200, maxX - minX + 120); var h = Math.max(120, maxY - minY + 110);
    var aspect = (svg.clientWidth || 700) / (svg.clientHeight || 320);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    var cx = (minX + maxX) / 2; var cy = (minY + maxY) / 2;
    var vb = [cx - w / 2, cy - h / 2, w, h];
    svg.setAttribute('viewBox', vb.map(function (v) { return v.toFixed(1); }).join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    var sc = w / 420; // keep symbols a constant on-screen size
    var grid = '';
    for (var lon = 66; lon <= 100; lon += 2) { var a = proj(40, lon); var b = proj(4, lon); grid += '<line class="map-grid" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke-width="' + (0.6 * sc) + '"/>'; }
    for (var lat = 4; lat <= 40; lat += 2) { var c = proj(lat, 64); var d = proj(lat, 100); grid += '<line class="map-grid" x1="' + c[0] + '" y1="' + c[1] + '" x2="' + d[0] + '" y2="' + d[1] + '" stroke-width="' + (0.6 * sc) + '"/>'; }
    var routeCodes = s.route.map(function (r) { return r.code; });
    var dots = airportsAll.filter(function (a) { return routeCodes.indexOf(a.code) < 0; }).map(function (a) { var p = proj(a.lat, a.lon); return '<g opacity=".55"><circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (2 * sc) + '" fill="#7dd3fc"/><text x="' + (p[0] + 5 * sc) + '" y="' + (p[1] + 3.5 * sc) + '" font-size="' + (10 * sc) + '" fill="#cbd5e1" font-family="Plus Jakarta Sans, sans-serif">' + a.code + '</text></g>'; }).join('');
    var ends = s.route.map(function (r, i) {
      var p = proj(r.lat, r.lon); var main = i === 0 || i === s.route.length - 1;
      return '<g><circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (9 * sc) + '" fill="#4cd6ff" opacity=".18"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + ((main ? 4.5 : 3.5) * sc) + '" fill="' + (main ? '#4cd6ff' : '#fbbf24') + '" stroke="#0b1f2a" stroke-width="' + (1.5 * sc) + '"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] - 13 * sc) + '" text-anchor="middle" font-size="' + (13 * sc) + '" font-weight="700" fill="#fff" font-family="Sora, sans-serif">' + r.code + '</text>' +
        '<text x="' + p[0] + '" y="' + (p[1] + 22 * sc) + '" text-anchor="middle" font-size="' + (10 * sc) + '" fill="#94a3b8" font-family="Plus Jakarta Sans, sans-serif">' + FC.esc(r.city) + '</text></g>';
    }).join('');
    var full = segs.map(pathOf).join(' ');
    svg.innerHTML = '<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + (3 * sc) + '" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      grid + dots +
      '<path d="' + full + '" fill="none" stroke="#7dd3fc" stroke-opacity=".55" stroke-width="' + (2 * sc) + '" stroke-dasharray="' + (5 * sc) + ' ' + (7 * sc) + '" stroke-linecap="round"/>' +
      '<path data-u="flown" d="" fill="none" stroke="#4cd6ff" stroke-width="' + (3 * sc) + '" stroke-linecap="round" filter="url(#glow)"/>' + ends +
      '<g data-u="plane" class="track-plane"><g transform="scale(' + (1.25 * sc) + ')"><circle r="18" fill="#4cd6ff" opacity=".18"/><path d="' + PLANE + '" fill="#fff" stroke="#0b1f2a" stroke-width="1"/></g></g>';
    map = { id: s.id, segs: segs, sc: sc, svg: svg };
  }

  function planeAt(s) {
    if (s.position) return { lat: s.position.lat, lon: s.position.lon, heading: s.position.heading };
    var a = s.route[0]; var b = s.route[1];
    var h = Math.atan2(Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R), Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R)) / R;
    return { lat: a.lat, lon: a.lon, heading: (h + 360) % 360 };
  }

  function update(s, first) {
    $('[data-u="pill"]').innerHTML = pill(s);
    var pct = Math.round(s.progress * 1000) / 10;
    $('[data-u="fill"]').style.width = pct + '%'; $('[data-u="pplane"]').style.left = pct + '%';
    var pt = ORDER[s.phase];
    $('[data-u="progresstext"]').textContent = pt < 2 ? 'Departs in ' + dur(s.minutesToDeparture) + (s.from.gate ? ' · Gate ' + s.from.gate : '')
      : s.phase === 'at_stop' ? 'On the ground at ' + s.route[1].city + ' · ' + dur(s.remainingMin) + ' to go'
        : pt < 4 ? pct.toFixed(0) + '% · lands in ' + dur(s.remainingMin) : 'Landed at ' + s.times.estimatedArrival + (s.to.belt ? ' · Baggage belt ' + s.to.belt : '');
    var depLate = s.delayMin >= 15; var arrLate = s.arrivalDelayMin >= 15;
    $('[data-u="dep"]').innerHTML = timeCell('Departure', s.times.scheduledDeparture, s.times.estimatedDeparture, depLate) + '<p class="text-sm mt-2"><span class="font-semibold">Terminal ' + s.from.terminal + '</span> · Gate ' + s.from.gate + '</p>';
    $('[data-u="arr"]').innerHTML = timeCell('Arrival', s.times.scheduledArrival, s.times.estimatedArrival, arrLate) + '<p class="text-sm mt-2"><span class="font-semibold">Terminal ' + s.to.terminal + '</span>' + (s.to.belt ? ' · Belt ' + s.to.belt : '') + '</p>';
    $('[data-u="timeline"]').innerHTML = STEPS.map(function (st, i) {
      var state = i < pt ? 'done' : i === Math.floor(pt) || (pt === 3 && i === 3) ? 'now' : 'todo';
      if (pt < 0) state = 'todo';
      var c = state === 'done' ? 'bg-primary text-white' : state === 'now' ? 'bg-white dark:bg-slate-900 text-primary dark:text-sky-300 border-2 border-primary dark:border-sky-300 ring-4 ring-primary/15' : 'bg-surface-container-high dark:bg-slate-700 text-on-surface-variant dark:text-slate-400';
      return '<li class="flex flex-col items-center text-center gap-1.5 relative"' + (state === 'now' ? ' aria-current="step"' : '') + '>' + (i ? '<span class="absolute top-4 right-1/2 w-full h-0.5 z-0 ' + (i <= pt ? 'bg-primary' : 'bg-surface-variant dark:bg-slate-600') + '" aria-hidden="true"></span>' : '') +
        '<span class="relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ' + c + '"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">' + (state === 'done' ? 'check' : st[2]) + '</span></span><span class="text-[11px] sm:text-xs font-semibold leading-tight ' + (state === 'todo' ? 'text-on-surface-variant dark:text-slate-400' : '') + '">' + st[1] + '</span></li>';
    }).join('');

    // map: plane glides to its new position over the polling interval
    if (map && map.id === s.id) {
      var p = planeAt(s); var q = proj(p.lat, p.lon);
      var plane = $('[data-u="plane"]');
      plane.style.setProperty('--glide', first || !FC.motion ? '0s' : (POLL / 1000) + 's');
      plane.style.transform = 'translate(' + q[0].toFixed(2) + 'px,' + q[1].toFixed(2) + 'px) rotate(' + p.heading + 'deg)';
      // flown part of the route
      var flown = [];
      if (ORDER[s.phase] >= 2) {
        var seg = Math.min(s.segment, map.segs.length - 1);
        for (var i = 0; i < seg; i++) flown = flown.concat(map.segs[i]);
        var cur = map.segs[seg]; var best = 0; var bd = Infinity;
        cur.forEach(function (pp, k) { var dd = Math.pow(pp[0] - p.lat, 2) + Math.pow(pp[1] - p.lon, 2); if (dd < bd) { bd = dd; best = k; } });
        flown = flown.concat(cur.slice(0, best + 1)); flown.push([p.lat, p.lon]);
        if (ORDER[s.phase] >= 4) flown = [].concat.apply([], map.segs);
      }
      $('[data-u="flown"]').setAttribute('d', flown.length > 1 ? pathOf(flown) : '');
      var pos = s.position || {};
      var chip = function (icon, label, val) { return '<span class="inline-flex items-center gap-1.5 bg-black/35 backdrop-blur rounded-lg px-2.5 py-1.5"><span class="material-symbols-outlined text-[16px] text-sky-300" aria-hidden="true">' + icon + '</span><span class="text-white/70">' + label + '</span><span class="font-bold">' + val + '</span></span>'; };
      $('[data-u="chips"]').innerHTML = ORDER[s.phase] >= 2 && ORDER[s.phase] < 4 && pos.altitudeFt != null
        ? chip('height', 'Alt', pos.altitudeFt.toLocaleString('en-IN') + ' ft') + chip('speed', 'Speed', pos.speedKts + ' kts') + chip('explore', 'Heading', pos.heading + '°') + chip('timer', 'Left', dur(s.remainingMin))
        : ORDER[s.phase] < 2 ? chip('schedule', 'Departs', s.times.estimatedDeparture + ' IST') + chip('door_front', 'Gate', s.from.gate) : chip('flight_land', 'Landed', s.times.estimatedArrival + ' IST') + (s.to.belt ? chip('luggage', 'Belt', s.to.belt) : '');
    }
  }

  // ---------- "in the air now" board ----------
  function loadLive() {
    FC.api('GET', '/track/live', null, { quiet: true }).then(function (r) {
      var first = !airportsAll.length; airportsAll = r.airports || airportsAll;
      if (first && current && map) buildMap(current), update(current, true);
      var list = $('#live-list'); list.setAttribute('aria-busy', 'false');
      list.innerHTML = r.flights.length ? r.flights.map(function (f) {
        return '<li><button type="button" data-load="' + FC.esc(f.id) + '" class="w-full text-left px-5 py-3.5 hover:bg-surface-container-low dark:hover:bg-slate-700/50 transition-colors flex items-center gap-3">' +
          '<span class="w-8 h-8 shrink-0 rounded-lg text-white text-[11px] font-bold flex items-center justify-center ' + (FC.airline[f.airline.code] || 'bg-slate-600') + '" aria-hidden="true">' + f.airline.code + '</span>' +
          '<span class="flex-1 min-w-0"><span class="flex justify-between gap-2 text-sm"><span class="font-bold">' + f.from + ' → ' + f.to + '</span><span class="text-on-surface-variant dark:text-slate-400">' + FC.esc(f.number) + '</span></span>' +
          '<span class="block h-1.5 mt-1.5 rounded-full bg-surface-variant dark:bg-slate-600 overflow-hidden"><span class="block h-full rounded-full bg-gradient-to-r from-primary to-sky-400" style="width:' + Math.round(f.progress * 100) + '%"></span></span>' +
          '<span class="block text-[11px] text-on-surface-variant dark:text-slate-400 mt-1">' + FC.esc(f.fromCity) + ' ' + f.depart + ' · lands ' + f.arrive + '</span></span></button></li>';
      }).join('') : '<li class="p-5 text-sm text-on-surface-variant dark:text-slate-300">No flights are in the air on our busy routes right now (most flights run 5am - 2am). Try searching a flight number.</li>';
    }, function () { $('#live-list').innerHTML = '<li class="p-5 text-sm">Live board unavailable.</li>'; });
  }
  loadLive(); setInterval(function () { if (!document.hidden) loadLive(); }, 60000);

  // ---------- boot from URL ----------
  var q = FC.qs();
  if (q.get('id')) load(q.get('id'), false);
  else if (q.get('number')) { numInput.value = q.get('number').toUpperCase(); if (q.get('date')) { day = q.get('date'); paintDays(); } search(q.get('number'), day); }
})();
