/* Results page: loads flights per leg, filters/sorts client-side, builds the fare hold on the server. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var p = FC.qs();
  var spec = parseSpec(p);
  var animateNext = false;
  var active = 0; var selected = []; var legData = []; var calendar = [];
  var f = { stops: { 0: true, 1: true }, excludeAirlines: {}, slots: { early: true, morning: true, afternoon: true, evening: true }, maxPrice: null, sort: 'price' };
  if (p.get('direct') === '1') f.stops[1] = false;
  // CI finding (P1: "Wait, where did my filter go?"): keep filters + sort when the user comes back to this search
  var FKEY = 'fc_filters:' + location.search;
  try { var saved = JSON.parse(sessionStorage.getItem(FKEY)); if (saved) { f.stops = saved.stops; f.excludeAirlines = saved.excludeAirlines; f.slots = saved.slots; f.sort = saved.sort; } } catch (e) { /* ignore */ }
  function saveFilters() { try { sessionStorage.setItem(FKEY, JSON.stringify({ stops: f.stops, excludeAirlines: f.excludeAirlines, slots: f.slots, sort: f.sort })); } catch (e) { /* ignore */ } }

  // ---------- parse URL ----------
  function parseSpec(q) {
    var trip = ['oneway', 'return', 'multicity'].indexOf(q.get('trip')) >= 0 ? q.get('trip') : 'oneway';
    var n = function (k, d) { var v = q.get(k); return v === null || v === '' ? d : Number(v); };
    var s = { trip: trip, adults: n('adults', 1), children: n('children', 0), infants: n('infants', 0), cabin: q.get('cabin') || 'Economy', direct: q.get('direct') === '1', legs: [] };
    var code = function (c) { return /^[A-Za-z]{3}$/.test(c || '') ? c.toUpperCase() : null; };
    var date = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null; };
    if (trip === 'multicity') {
      (q.get('legs') || '').split(',').forEach(function (x) { var a = x.split(':'); if (code(a[0]) && code(a[1]) && date(a[2])) s.legs.push({ from: code(a[0]), to: code(a[1]), date: a[2] }); });
    } else if (code(q.get('from')) && code(q.get('to')) && date(q.get('date'))) {
      s.legs.push({ from: code(q.get('from')), to: code(q.get('to')), date: q.get('date') });
      if (trip === 'return') { if (date(q.get('return'))) s.legs.push({ from: code(q.get('to')), to: code(q.get('from')), date: q.get('return') }); else s.legs = []; }
    }
    return s;
  }
  function toQuery() {
    var o = new URLSearchParams(); o.set('trip', spec.trip);
    if (spec.trip === 'multicity') o.set('legs', spec.legs.map(function (l) { return l.from + ':' + l.to + ':' + l.date; }).join(','));
    else { o.set('from', spec.legs[0].from); o.set('to', spec.legs[0].to); o.set('date', spec.legs[0].date); if (spec.trip === 'return') o.set('return', spec.legs[1].date); }
    o.set('adults', spec.adults); o.set('children', spec.children); o.set('infants', spec.infants); o.set('cabin', spec.cabin); if (spec.direct) o.set('direct', '1');
    return o.toString();
  }
  var seats = function () { return spec.adults + spec.children; };
  var travellers = function () { return spec.adults + spec.children + spec.infants; };
  var cities = {};
  function remember(q) { cities[q.from.code] = q.from.city; cities[q.to.code] = q.to.city; }
  var city = function (c) { return cities[c] || c; };

  // ---------- boot ----------
  if (!spec.legs.length || spec.legs.length > 4 || spec.adults < 1) { show('#no-search-msg'); return; }
  $('#modify-link').href = '/?' + toQuery();
  $('#results-wrap').classList.remove('hidden');
  $('#stepper').setAttribute('data-step', '1'); FC.renderStepper();
  $$('#filter-stops input').forEach(function (i) { i.checked = !!f.stops[i.value]; }); $('#sort-select').value = f.sort;
  renderSummary(); loadLeg(0);

  function show(sel) { $(sel).classList.remove('hidden'); }
  function renderSummary() {
    var route = spec.trip === 'multicity' ? spec.legs.map(function (l) { return city(l.from); }).concat(city(spec.legs[spec.legs.length - 1].to)).join(' → ') : city(spec.legs[0].from) + (spec.trip === 'return' ? ' ⇄ ' : ' → ') + city(spec.legs[0].to);
    $('#summary-route').textContent = route;
    $('#summary-date').textContent = spec.trip === 'return' ? FC.fmtShort(spec.legs[0].date) + ' - ' + FC.fmtShort(spec.legs[1].date) : spec.trip === 'oneway' ? FC.fmtDate(spec.legs[0].date) : FC.fmtShort(spec.legs[0].date) + ' - ' + FC.fmtShort(spec.legs[spec.legs.length - 1].date);
    $('#summary-pax').textContent = FC.plural(travellers(), 'Traveller') + ', ' + spec.cabin;
    document.title = route + ' flights - FlyCompare';
  }

  // ---------- data ----------
  function legParams(i) { var l = spec.legs[i]; return 'from=' + l.from + '&to=' + l.to + '&date=' + l.date + '&cabin=' + encodeURIComponent(spec.cabin) + '&adults=' + spec.adults + '&children=' + spec.children + '&infants=' + spec.infants; }
  function loadLeg(i) {
    active = i; $('#load-error').classList.add('hidden'); $('#empty-results').classList.add('hidden'); renderTabs(); renderSkeleton();
    var mine = (loadLeg.n = (loadLeg.n || 0) + 1);
    Promise.all([FC.api('GET', '/flights/search?' + legParams(i)), FC.api('GET', '/flights/calendar?' + legParams(i)).catch(function () { return { days: [] }; })]).then(function (r) {
      if (mine !== loadLeg.n) return;
      legData[i] = r[0]; calendar = r[1].days; remember(r[0].query);
      var prices = r[0].flights.map(function (x) { return x.price; });
      f.maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
      var slider = $('#price-max'); slider.min = prices.length ? Math.floor(Math.min.apply(null, prices) / 100) * 100 : 0; slider.max = f.maxPrice; slider.value = f.maxPrice;
      renderSummary(); renderTabs(); renderAirlines(); renderStrip(); animateNext = true; render(); updateBar();
    }).catch(function (e) {
      if (mine !== loadLeg.n) return;
      $('#flights-list').innerHTML = ''; show('#load-error');
      if (e.status === 422 && e.fields) { $('#load-error-text').textContent = Object.keys(e.fields).map(function (k) { return e.fields[k]; }).join(' '); $('#retry-load').textContent = 'Modify search'; $('#retry-load').setAttribute('data-modify', '1'); }
      else { $('#load-error-text').textContent = e.message; $('#retry-load').textContent = 'Try again'; $('#retry-load').removeAttribute('data-modify'); }
    });
  }
  $('#retry-load').addEventListener('click', function (e) { if (e.currentTarget.getAttribute('data-modify')) location.href = $('#modify-link').href; else loadLeg(active); });

  function renderSkeleton() {
    $('#flights-list').innerHTML = [1, 2, 3, 4].map(function () { return '<div class="skeleton h-28"></div>'; }).join('');
    $('#results-count').textContent = '–';
  }

  // ---------- leg tabs ----------
  function renderTabs() {
    var box = $('#leg-tabs'); box.classList.toggle('hidden', spec.legs.length < 2);
    box.innerHTML = spec.legs.map(function (l, i) {
      var on = i === active; var sel = selected[i];
      var title = spec.trip === 'return' ? (i === 0 ? 'Outbound' : 'Return') : 'Flight ' + (i + 1);
      return '<li><button type="button" data-leg="' + i + '" class="text-left min-w-[220px] border-2 rounded-xl px-4 py-3 transition-all ' + (on ? 'border-primary bg-primary/5' : 'border-surface-variant dark:border-slate-600 hover:border-primary') + '" ' + (on ? 'aria-current="step"' : '') + '>' +
        '<span class="flex items-center justify-between text-xs font-bold uppercase text-on-surface-variant dark:text-slate-400"><span>' + title + '</span>' + (sel ? '<span class="material-symbols-outlined text-emerald-600 text-[18px]" aria-label="selected">check_circle</span>' : '') + '</span>' +
        '<span class="block font-bold">' + FC.esc(city(l.from)) + ' → ' + FC.esc(city(l.to)) + '</span>' +
        '<span class="block text-xs text-on-surface-variant dark:text-slate-300">' + FC.fmtDate(l.date) + (sel ? ' · ' + sel.number + ' · ' + sel.depart + ' · ' + FC.money(sel.price) : ' · choose a flight') + '</span></button></li>';
    }).join('');
  }
  $('#leg-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-leg]'); if (b && Number(b.dataset.leg) !== active) { loadLeg(Number(b.dataset.leg)); } });

  // ---------- flexible dates ----------
  function renderStrip() {
    var strip = $('#date-strip'); var l = spec.legs[active]; var min = active > 0 ? spec.legs[active - 1].date : FC.todayISO();
    var cheapest = Math.min.apply(null, calendar.filter(function (d) { return d.from; }).map(function (d) { return d.from; }));
    strip.innerHTML = calendar.map(function (d) {
      var on = d.date === l.date; var dis = d.date < min;
      return '<button type="button" data-date="' + d.date + '" ' + (dis ? 'disabled' : '') + ' aria-pressed="' + on + '" class="rounded-lg border px-2 py-2 text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' + (on ? 'border-primary bg-primary text-white' : 'border-surface-variant dark:border-slate-600 hover:border-primary') + '">' +
        '<span class="block text-[11px] ' + (on ? 'text-white/90' : 'text-on-surface-variant dark:text-slate-400') + '">' + new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) + '</span>' +
        '<span class="block text-sm font-bold ' + (!on && d.from === cheapest ? 'text-emerald-600' : '') + '">' + (d.from ? FC.money(d.from) : '—') + '</span></button>';
    }).join('');
  }
  $('#date-strip').addEventListener('click', function (e) {
    var b = e.target.closest('[data-date]'); if (!b || b.disabled) return;
    var d = b.dataset.date; spec.legs[active].date = d; selected[active] = null;
    for (var i = active + 1; i < spec.legs.length; i++) if (spec.legs[i].date < d) { spec.legs[i].date = d; selected[i] = null; }
    history.replaceState(null, '', '?' + toQuery()); $('#modify-link').href = '/?' + toQuery(); loadLeg(active);
  });

  // ---------- filters ----------
  function renderAirlines() {
    var list = legData[active].airlines;
    $('#filter-airlines').innerHTML = list.map(function (a) {
      return '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" value="' + a.code + '" ' + (f.excludeAirlines[a.code] ? '' : 'checked') + ' class="rounded text-primary focus:ring-primary"/><span class="w-5 h-5 rounded text-white text-[10px] font-bold flex items-center justify-center ' + (FC.airline[a.code] || 'bg-slate-600') + '" aria-hidden="true">' + a.code + '</span><span>' + FC.esc(a.name) + '</span></label>';
    }).join('');
    $$('.slot-btn').forEach(paintSlot);
  }
  function paintSlot(b) { var on = f.slots[b.dataset.slot]; b.setAttribute('aria-pressed', String(on)); b.className = 'slot-btn border rounded-lg p-2 text-center text-xs transition-all ' + (on ? 'border-primary bg-primary/10 text-primary dark:text-sky-300 font-semibold' : 'border-surface-variant dark:border-slate-600 opacity-60'); }
  $('#filter-stops').addEventListener('change', function (e) { f.stops[e.target.value] = e.target.checked; render(); });
  $('#filter-airlines').addEventListener('change', function (e) { f.excludeAirlines[e.target.value] = !e.target.checked; render(); });
  $('#filter-time').addEventListener('click', function (e) { var b = e.target.closest('.slot-btn'); if (!b) return; f.slots[b.dataset.slot] = !f.slots[b.dataset.slot]; paintSlot(b); render(); });
  $('#price-max').addEventListener('input', function (e) { f.maxPrice = Number(e.target.value); render(); });
  $('#sort-select').addEventListener('change', function (e) { f.sort = e.target.value; render(); });
  function reset() {
    f.stops = { 0: true, 1: true }; f.excludeAirlines = {}; f.slots = { early: true, morning: true, afternoon: true, evening: true };
    $$('#filter-stops input').forEach(function (i) { i.checked = true; });
    if (legData[active]) { var max = Math.max.apply(null, legData[active].flights.map(function (x) { return x.price; })); f.maxPrice = max; $('#price-max').value = max; renderAirlines(); }
    render(); FC.toast('Filters reset', 'info');
  }
  $('#reset-filters').addEventListener('click', reset); $('#empty-reset').addEventListener('click', reset);
  $('#filters-toggle').addEventListener('click', function (e) { var panel = $('#filters-panel'); var open = panel.classList.toggle('hidden') === false; e.currentTarget.setAttribute('aria-expanded', String(open)); });

  var slotOf = function (m) { var h = m / 60; return h < 6 ? 'early' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };
  var absMin = function (fl) { return Math.round((new Date(fl.date + 'T00:00:00Z') - new Date('2000-01-01T00:00:00Z')) / 60000) + fl.departMin; };

  function visible() {
    var d = legData[active]; if (!d) return [];
    var prev = active > 0 ? selected[active - 1] : null; var prevArrival = prev ? absMin(prev) + prev.durationMin : -1;
    var out = d.flights.filter(function (fl) {
      return f.stops[fl.stops] && !f.excludeAirlines[fl.airline.code] && f.slots[slotOf(fl.departMin)] && fl.price <= f.maxPrice && absMin(fl) > prevArrival;
    });
    var key = { price: function (a, b) { return a.price - b.price || a.departMin - b.departMin; }, duration: function (a, b) { return a.durationMin - b.durationMin || a.price - b.price; }, departure: function (a, b) { return a.departMin - b.departMin; }, arrival: function (a, b) { return (a.departMin + a.durationMin) - (b.departMin + b.durationMin); } }[f.sort];
    return out.sort(key);
  }
  function filterCount() {
    var d = legData[active]; var n = 0; if (!d) return 0;
    if (!f.stops[0] || !f.stops[1]) n++; if (Object.keys(f.excludeAirlines).some(function (k) { return f.excludeAirlines[k]; })) n++;
    if (Object.keys(f.slots).some(function (k) { return !f.slots[k]; })) n++;
    if (f.maxPrice < Math.max.apply(null, d.flights.map(function (x) { return x.price; }))) n++;
    return n;
  }

  // ---------- flight cards ----------
  function render() {
    saveFilters();
    var d = legData[active]; if (!d) return;
    var list = visible(); var box = $('#flights-list');
    $('#results-count').textContent = list.length; $('#price-max-label').textContent = '≤ ' + FC.money(f.maxPrice);
    var fc = filterCount(); var badge = $('#filters-badge'); badge.textContent = fc; badge.classList.toggle('hidden', !fc);
    var l = spec.legs[active];
    $('#results-sub').textContent = city(l.from) + ' → ' + city(l.to) + ' · ' + FC.fmtDate(l.date) + ' · prices per adult, taxes included';
    var empty = $('#empty-results');
    if (!list.length) {
      empty.classList.remove('hidden'); box.innerHTML = '';
      var none = !d.flights.length;
      $('#empty-title').textContent = none ? 'No flights on this date' : 'No flights match your filters';
      $('#empty-text').textContent = none ? 'Try another date from the strip above.' : active > 0 && selected[active - 1] ? 'Flights that leave before your previous flight lands are hidden. Try widening the filters or another date.' : 'Try widening your filters to see more results.';
      $('#empty-reset').classList.toggle('hidden', none); return;
    }
    empty.classList.add('hidden');
    box.classList.toggle('stagger', animateNext); animateNext = false;
    var cheapest = Math.min.apply(null, d.flights.map(function (x) { return x.price; })); var fastest = Math.min.apply(null, d.flights.map(function (x) { return x.durationMin; }));
    box.innerHTML = list.map(function (fl, i) {
      var isSel = selected[active] && selected[active].id === fl.id; var enough = fl.seatsLeft >= seats();
      var party = fl.price * (spec.adults + spec.children) + fl.infantPrice * spec.infants;
      var last = active === spec.legs.length - 1;
      var label = isSel ? 'Selected' : spec.legs.length > 1 && !last ? 'Select' : spec.legs.length > 1 ? 'Select' : 'Book';
      return '<article class="print-card bg-surface-container-lowest dark:bg-slate-800 rounded-xl border-2 ' + (isSel ? 'border-primary' : 'border-surface-variant dark:border-slate-700') + ' p-5 hover:shadow-md transition-all slide-up" style="animation-delay:' + Math.min(i, 8) * 0.04 + 's" data-id="' + fl.id + '">' +
        '<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">' +
        '<div class="flex items-center gap-4 md:w-48"><div class="' + (FC.airline[fl.airline.code] || 'bg-slate-600') + ' text-white w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs" aria-hidden="true">' + fl.airline.code + '</div><div><p class="font-bold">' + FC.esc(fl.airline.name) + '</p><p class="text-xs text-on-surface-variant dark:text-slate-400">' + fl.number + '</p></div></div>' +
        '<div class="flex items-center gap-4 sm:gap-6 flex-1 justify-center w-full md:w-auto">' +
        '<div class="text-center"><p class="text-lg font-bold">' + fl.depart + '</p><p class="text-xs text-on-surface-variant dark:text-slate-400">' + fl.from + '</p></div>' +
        '<div class="flex flex-col items-center w-24 sm:w-28"><p class="text-xs text-on-surface-variant dark:text-slate-400">' + fl.duration + '</p><div class="w-full h-[2px] bg-surface-variant dark:bg-slate-600 my-1 relative"><div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 ' + (fl.stops ? 'bg-amber-500' : 'bg-emerald-500') + ' rounded-full"></div></div><p class="text-[11px] font-semibold ' + (fl.stops ? 'text-amber-600' : 'text-emerald-600') + '">' + FC.esc(fl.stopsLabel) + '</p></div>' +
        '<div class="text-center"><p class="text-lg font-bold">' + fl.arrive + (fl.arrivalDayOffset ? '<sup class="text-[10px] text-red-600 ml-0.5">+' + fl.arrivalDayOffset + '</sup>' : '') + '</p><p class="text-xs text-on-surface-variant dark:text-slate-400">' + fl.to + '</p></div></div>' +
        '<div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end"><div class="text-right"><p class="text-2xl font-bold text-primary dark:text-sky-300 font-price-display">' + FC.money(fl.price) + '</p><p class="text-[10px] text-on-surface-variant dark:text-slate-400">per adult' + (travellers() > 1 ? ' · ' + FC.money(party) + ' total' : '') + '</p></div>' +
        '<button type="button" data-select="' + fl.id + '" ' + (enough ? '' : 'disabled') + ' class="px-6 py-2.5 rounded-lg font-bold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ' + (isSel ? 'bg-emerald-600 text-white' : 'bg-primary text-on-primary hover:bg-primary/90') + '">' + (isSel ? '<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">check</span>Selected</span>' : label) + '</button></div></div>' +
        '<div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-surface-variant/70 dark:border-slate-700 text-xs">' +
        (fl.price === cheapest ? '<span class="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full font-bold">Cheapest</span>' : '') +
        (fl.durationMin === fastest ? '<span class="bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-2 py-0.5 rounded-full font-bold">Fastest</span>' : '') +
        (!enough ? '<span class="text-red-600 font-semibold">Only ' + fl.seatsLeft + ' seat' + (fl.seatsLeft === 1 ? '' : 's') + ' left — not enough for your group</span>' : fl.seatsLeft <= 6 ? '<span class="text-orange-600 font-semibold">Only ' + fl.seatsLeft + ' seats left</span>' : '') +
        '<span class="text-on-surface-variant dark:text-slate-400 ml-auto">Cabin ' + fl.baggage.cabin + ' · Check-in ' + fl.baggage.checkin + '</span></div></article>';
    }).join('');
  }
  $('#flights-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-select]'); if (!b || b.disabled) return;
    var fl = legData[active].flights.filter(function (x) { return x.id === b.dataset.select; })[0]; if (!fl) return;
    selected[active] = fl;
    // a later leg chosen earlier may no longer make sense
    for (var i = active + 1; i < spec.legs.length; i++) if (selected[i] && absMin(selected[i]) <= absMin(fl) + fl.durationMin) selected[i] = null;
    var next = -1; for (var j = active + 1; j < spec.legs.length; j++) if (!selected[j]) { next = j; break; }
    if (next < 0) for (var k = 0; k < spec.legs.length; k++) if (!selected[k]) { next = k; break; }
    if (next >= 0) { FC.toast(fl.airline.name + ' ' + fl.number + ' selected. Now choose flight ' + (next + 1) + ' of ' + spec.legs.length + '.', 'success'); window.scrollTo({ top: 0, behavior: 'smooth' }); loadLeg(next); }
    else { render(); renderTabs(); updateBar(); }
    updateBar();
  });

  // ---------- trip bar + continue ----------
  function updateBar() {
    var bar = $('#trip-bar'); var chosen = selected.filter(Boolean); if (!chosen.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var total = chosen.reduce(function (s, x) { return s + x.price * (spec.adults + spec.children) + x.infantPrice * spec.infants; }, 0);
    var complete = chosen.length === spec.legs.length;
    $('#trip-bar-total').textContent = FC.money(total); $('#trip-bar-label').textContent = (complete ? 'Total' : 'So far') + ' · ' + FC.plural(travellers(), 'traveller');
    $('#trip-bar-text').innerHTML = chosen.map(function (x) { return '<span class="inline-flex items-center gap-1 mr-3"><span class="font-bold">' + x.from + '→' + x.to + '</span> ' + x.airline.code + ' ' + x.depart + '</span>'; }).join('') + (complete ? '' : '<span class="text-on-surface-variant dark:text-slate-300">(' + (spec.legs.length - chosen.length) + ' more to choose)</span>');
    var btn = $('#continue-btn'); btn.disabled = !complete; $('#continue-text').textContent = complete ? 'Continue to passenger details' : 'Choose all flights';
  }
  $('#continue-btn').addEventListener('click', function () {
    var btn = $('#continue-btn'); btn.disabled = true; $('#continue-spin').classList.remove('hidden'); $('#continue-text').textContent = 'Holding your fare...';
    FC.api('POST', '/bookings', { tripType: spec.trip, flightIds: selected.map(function (x) { return x.id; }), adults: spec.adults, children: spec.children, infants: spec.infants, cabin: spec.cabin }).then(function (r) {
      location.href = '/booking.html?b=' + encodeURIComponent(r.booking.token);
    }).catch(function (e) {
      FC.toast(e.message + (e.fields ? ' ' + Object.keys(e.fields).map(function (k) { return e.fields[k]; }).join(' ') : ''), 'error');
      if (e.code === 'flight_unavailable') { selected = []; loadLeg(0); }
      $('#continue-spin').classList.add('hidden'); updateBar();
    });
  });
})();
