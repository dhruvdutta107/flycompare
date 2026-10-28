/* Home page: search form, travellers popover, multi-city legs, deals, recent searches. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$; var $$ = FC.$$;
  var form = $('#search-form');
  var state = { trip: 'return', adults: 1, children: 0, infants: 0, cabin: 'Economy' };
  var legs = []; // multi-city rows: {from:{code,label}|null, to, date}
  var today = FC.todayISO();

  var fromInput = $('#input-from'); var toInput = $('#input-to');
  var depart = $('#date-depart'); var ret = $('#date-return');
  FC.airportInput(fromInput); FC.airportInput(toInput);
  depart.min = today; ret.min = today; depart.value = FC.addDays(today, 7); ret.value = FC.addDays(today, 10);

  // ---------- trip type tabs ----------
  function setTrip(t) {
    state.trip = t;
    $$('.trip-tab').forEach(function (b) {
      var on = b.getAttribute('data-trip') === t; b.setAttribute('aria-pressed', String(on));
      b.className = 'trip-tab px-4 py-2 rounded-lg font-label-md text-label-md flex items-center gap-xs transition-all ' + (on ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant dark:text-slate-300 hover:text-primary hover:bg-surface-container-low dark:hover:bg-slate-700');
    });
    var multi = t === 'multicity';
    $('#simple-fields').classList.toggle('hidden', multi); $('#multi-fields').classList.toggle('hidden', !multi);
    var rc = $('#return-container'); rc.style.opacity = t === 'oneway' ? '0.4' : '1'; rc.style.pointerEvents = t === 'oneway' ? 'none' : 'auto'; ret.disabled = t === 'oneway';
    if (multi && !legs.length) seedLegs();
    if (multi) renderLegs();
  }
  $('#trip-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-trip]'); if (b) setTrip(b.getAttribute('data-trip')); });

  // ---------- swap (desktop + mobile buttons share one handler) ----------
  $$('[data-swap]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var v = fromInput.value; var c = fromInput.dataset.code;
      fromInput.value = toInput.value; toInput.value = v;
      if (toInput.dataset.code) fromInput.dataset.code = toInput.dataset.code; else delete fromInput.dataset.code;
      if (c) toInput.dataset.code = c; else delete toInput.dataset.code;
      FC.clearErrors(form); btn.classList.add('spin-once'); setTimeout(function () { btn.classList.remove('spin-once'); }, 400);
      FC.toast('Cities swapped', 'success');
    });
  });

  // ---------- dates ----------
  depart.addEventListener('change', function () {
    FC.setError(form, 'date', '');
    if (ret.value && ret.value < depart.value) ret.value = depart.value;
    ret.min = depart.value || today;
  });
  ret.addEventListener('change', function () { FC.setError(form, 'return', ''); });

  // ---------- travellers ----------
  var pop = $('#travellers-pop'); var tbtn = $('#travellers-btn');
  function renderPax() {
    var total = state.adults + state.children + state.infants;
    ['adults', 'children', 'infants'].forEach(function (k) { $('#count-' + k).textContent = state[k]; });
    $('#travellers-display').textContent = (total === 1 ? '1 Adult' : total + ' Travellers') + ', ' + state.cabin;
    var seats = state.adults + state.children;
    function dis(k, d, v) { var b = $('[data-pax="' + k + '"][data-d="' + d + '"]'); b.disabled = v; }
    dis('adults', '-1', state.adults <= 1); dis('adults', '1', seats >= 9);
    dis('children', '-1', state.children <= 0); dis('children', '1', seats >= 9 || state.children >= 6);
    dis('infants', '-1', state.infants <= 0); dis('infants', '1', state.infants >= state.adults);
    $('#pax-hint').textContent = seats >= 9 ? 'Maximum of 9 seats reached.' : state.infants >= state.adults ? 'Each infant must travel with an adult.' : 'You can book up to 9 seats at once.';
  }
  function togglePop(open) { pop.hidden = !open; tbtn.setAttribute('aria-expanded', String(open)); }
  tbtn.addEventListener('click', function () { togglePop(pop.hidden); });
  $('#travellers-done').addEventListener('click', function () { togglePop(false); tbtn.focus(); });
  document.addEventListener('click', function (e) { if (!pop.hidden && !e.target.closest('#travellers-pop') && !e.target.closest('#travellers-btn')) togglePop(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { togglePop(false); tbtn.focus(); } });
  pop.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pax]'); if (!b || b.disabled) return;
    var k = b.getAttribute('data-pax'); state[k] += Number(b.getAttribute('data-d'));
    if (state.infants > state.adults) state.infants = state.adults;
    renderPax();
  });
  pop.addEventListener('change', function (e) { if (e.target.name === 'cabin') { state.cabin = e.target.value; renderPax(); } });

  // ---------- multi-city ----------
  function seedLegs() {
    var f = codeOf(fromInput); var t = codeOf(toInput);
    legs = [
      { from: f ? { code: f, label: fromInput.value } : null, to: t ? { code: t, label: toInput.value } : null, date: depart.value || FC.addDays(today, 7) },
      { from: t ? { code: t, label: toInput.value } : null, to: null, date: FC.addDays(depart.value || today, 3) },
    ];
  }
  function legRow(l, i) {
    var wrap = document.createElement('div'); wrap.className = 'grid grid-cols-1 md:grid-cols-12 gap-sm items-start'; wrap.setAttribute('data-leg', i);
    function cell(label, inner) { return '<div class="field-wrap border border-surface-variant dark:border-slate-600 rounded-lg p-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 bg-white dark:bg-slate-800 relative"><label class="block font-label-md text-[10px] text-outline dark:text-slate-400 uppercase tracking-wider mb-1 font-bold">' + label + '</label>' + inner + '</div>'; }
    var loc = function (key, v) { return '<div class="flex items-center gap-xs"><span class="material-symbols-outlined text-outline text-[18px]" aria-hidden="true">location_on</span><input data-leg-' + key + ' aria-label="Flight ' + (i + 1) + ' ' + key + '" class="bare font-body-md font-semibold w-full" type="text" placeholder="City or airport" value="' + FC.esc(v ? v.label : '') + '"' + (v ? ' data-code="' + v.code + '"' : '') + '/></div>'; };
    wrap.innerHTML = '<div class="md:col-span-1 flex md:items-center md:h-[62px] text-sm font-bold text-primary dark:text-sky-300">Flight ' + (i + 1) + '</div>' +
      '<div class="md:col-span-4">' + cell('From', loc('from', l.from)) + '</div><div class="md:col-span-4">' + cell('To', loc('to', l.to)) + '</div>' +
      '<div class="md:col-span-2">' + cell('Date', '<input data-leg-date aria-label="Flight ' + (i + 1) + ' date" type="date" class="bare font-body-md font-semibold w-full cursor-pointer" min="' + today + '" value="' + l.date + '"/>') + '</div>' +
      '<div class="md:col-span-1 flex md:items-center md:h-[62px]">' + (legs.length > 2 ? '<button type="button" data-remove-leg="' + i + '" class="text-on-surface-variant hover:text-red-600 p-2" aria-label="Remove flight ' + (i + 1) + '"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>' : '') + '</div>';
    return wrap;
  }
  function renderLegs() {
    var list = $('#legs-list'); list.innerHTML = '';
    legs.forEach(function (l, i) {
      var row = legRow(l, i); list.appendChild(row);
      var fi = $('[data-leg-from]', row); var ti = $('[data-leg-to]', row); var di = $('[data-leg-date]', row);
      FC.airportInput(fi, function (a) { l.from = { code: a.code, label: a.label }; });
      FC.airportInput(ti, function (a) { l.to = { code: a.code, label: a.label }; if (legs[i + 1] && !legs[i + 1].from) { legs[i + 1].from = { code: a.code, label: a.label }; renderLegs(); } });
      fi.addEventListener('input', function () { l.from = null; }); ti.addEventListener('input', function () { l.to = null; });
      di.addEventListener('change', function () { l.date = di.value; });
    });
    $('#add-leg').hidden = legs.length >= 4;
  }
  $('#add-leg').addEventListener('click', function () {
    var last = legs[legs.length - 1];
    legs.push({ from: last.to, to: null, date: FC.addDays(last.date || today, 3) }); renderLegs();
  });
  $('#legs-list').addEventListener('click', function (e) { var b = e.target.closest('[data-remove-leg]'); if (b) { legs.splice(Number(b.getAttribute('data-remove-leg')), 1); renderLegs(); } });

  // ---------- resolve + validate + submit ----------
  var codeOf = function (input) { return input.dataset.code || ''; };
  function resolve(input) {
    if (input.dataset.code) return Promise.resolve(input.dataset.code);
    var q = input.value.trim(); if (!q) return Promise.resolve('');
    return FC.api('GET', '/airports?q=' + encodeURIComponent(q)).then(function (r) {
      var low = q.toLowerCase(); var hit = r.airports.filter(function (a) { return a.city.toLowerCase() === low || a.code.toLowerCase() === low || a.label.toLowerCase() === low; })[0] || (r.airports.length === 1 ? r.airports[0] : null);
      if (hit) { input.value = hit.label; input.dataset.code = hit.code; return hit.code; }
      return '';
    }, function () { return ''; });
  }
  function qsFor(s) {
    var p = new URLSearchParams();
    p.set('trip', s.trip);
    if (s.trip === 'multicity') p.set('legs', s.legs.map(function (l) { return l.from + ':' + l.to + ':' + l.date; }).join(','));
    else { p.set('from', s.from); p.set('to', s.to); p.set('date', s.date); if (s.trip === 'return') p.set('return', s.ret); }
    p.set('adults', s.adults); p.set('children', s.children); p.set('infants', s.infants); p.set('cabin', s.cabin);
    if (s.direct) p.set('direct', '1');
    return p.toString();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault(); FC.clearErrors(form);
    var btn = $('#search-btn'); var txt = $('#search-btn-text'); var errors = {};
    var base = { trip: state.trip, adults: state.adults, children: state.children, infants: state.infants, cabin: state.cabin, direct: $('#direct-flights').checked };
    btn.disabled = true; txt.textContent = 'Checking...'; var icon = btn.querySelector('.material-symbols-outlined'); icon.textContent = 'progress_activity'; icon.classList.add('spin');
    var job;
    if (state.trip === 'multicity') {
      job = Promise.all(legs.map(function (l, i) {
        var row = $('[data-leg="' + i + '"]'); return Promise.all([resolve($('[data-leg-from]', row)), resolve($('[data-leg-to]', row))]).then(function (c) { l._f = c[0]; l._t = c[1]; });
      })).then(function () {
        var msgs = [];
        legs.forEach(function (l, i) {
          var n = 'Flight ' + (i + 1);
          if (!l._f) msgs.push(n + ': choose a departure city from the list.');
          else if (!l._t) msgs.push(n + ': choose a destination city from the list.');
          else if (l._f === l._t) msgs.push(n + ': origin and destination cannot be the same.');
          if (!l.date) msgs.push(n + ': pick a date.'); else if (l.date < today) msgs.push(n + ': the date is in the past.');
          else if (i > 0 && legs[i - 1].date && l.date < legs[i - 1].date) msgs.push(n + ': must not be before flight ' + i + '.');
        });
        if (msgs.length) { errors.legs = msgs[0]; return null; }
        return Object.assign(base, { legs: legs.map(function (l) { return { from: l._f, to: l._t, date: l.date }; }) });
      });
    } else {
      job = Promise.all([resolve(fromInput), resolve(toInput)]).then(function (c) {
        if (!c[0]) errors.from = fromInput.value.trim() ? 'We could not find that city. Pick one from the list.' : 'Choose where you are flying from.';
        if (!c[1]) errors.to = toInput.value.trim() ? 'We could not find that city. Pick one from the list.' : 'Choose where you are flying to.';
        if (c[0] && c[1] && c[0] === c[1]) errors.to = 'Origin and destination cannot be the same.';
        if (!depart.value) errors.date = 'Pick a departure date.'; else if (depart.value < today) errors.date = 'Departure date cannot be in the past.';
        if (state.trip === 'return') { if (!ret.value) errors.return = 'Pick a return date.'; else if (depart.value && ret.value < depart.value) errors.return = 'Return date cannot be before departure.'; }
        if (Object.keys(errors).length) return null;
        return Object.assign(base, { from: c[0], to: c[1], date: depart.value, ret: ret.value });
      });
    }
    job.then(function (s) {
      if (!s) { FC.applyErrors(form, errors); btn.disabled = false; txt.textContent = 'Search Flights'; icon.textContent = 'search'; icon.classList.remove('spin'); return; }
      txt.textContent = 'Searching...'; saveRecent(s); location.href = '/results.html?' + qsFor(s);
    });
  });
  [fromInput, toInput].forEach(function (i) { i.addEventListener('input', function () { FC.setError(form, i.name, ''); }); });

  // ---------- recent searches ----------
  function saveRecent(s) {
    var label = function (input, code) { return input.dataset.code === code ? input.value : code; };
    var item = s.trip === 'multicity' ? { qs: qsFor(s), title: s.legs.map(function (l) { return l.from; }).concat(s.legs[s.legs.length - 1].to).join(' > '), date: s.legs[0].date }
      : { qs: qsFor(s), title: label(fromInput, s.from).split('(')[0].trim() + ' > ' + label(toInput, s.to).split('(')[0].trim(), date: s.date };
    var list = FC.store.get('fc_recent', []).filter(function (r) { return r.title !== item.title; }); list.unshift(item);
    FC.store.set('fc_recent', list.slice(0, 5));
  }
  function loadRecent() {
    var list = FC.store.get('fc_recent', []); var sec = $('#recent-searches');
    if (!list.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden'); var box = $('#recent-list'); box.innerHTML = '';
    list.forEach(function (r) {
      var chip = document.createElement('button'); chip.type = 'button';
      chip.className = 'flex-shrink-0 bg-surface-container-low dark:bg-slate-800 border border-surface-variant dark:border-slate-600 rounded-full px-4 py-2 text-sm hover:border-primary transition-colors flex items-center gap-2';
      chip.innerHTML = '<span class="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true">history</span><span class="font-semibold">' + FC.esc(r.title.replace(/ > /g, ' → ')) + '</span>';
      chip.addEventListener('click', function () { prefill(new URLSearchParams(r.qs)); window.scrollTo({ top: 0, behavior: 'smooth' }); $('#search-btn').focus({ preventScroll: true }); });
      box.appendChild(chip);
    });
  }
  $('#clear-recent').addEventListener('click', function () { FC.store.del('fc_recent'); loadRecent(); });

  // ---------- prefill (from "Modify search", recent chips) ----------
  function fill(input, code) {
    return FC.api('GET', '/airports?q=' + encodeURIComponent(code)).then(function (r) { var a = r.airports.filter(function (x) { return x.code === code; })[0]; if (a) { input.value = a.label; input.dataset.code = a.code; } return a; });
  }
  function prefill(p) {
    var trip = p.get('trip'); var n = function (k, d) { var v = Number(p.get(k)); return Number.isInteger(v) ? v : d; };
    state.adults = Math.min(9, Math.max(1, n('adults', 1))); state.children = Math.min(6, Math.max(0, n('children', 0))); state.infants = Math.min(state.adults, Math.max(0, n('infants', 0)));
    if (['Economy', 'Premium Economy', 'Business'].indexOf(p.get('cabin')) >= 0) { state.cabin = p.get('cabin'); $('input[name=cabin][value="' + state.cabin + '"]').checked = true; }
    $('#direct-flights').checked = p.get('direct') === '1'; renderPax();
    var d = p.get('date'); if (d && d >= today) depart.value = d; var r = p.get('return'); if (r && r >= depart.value) ret.value = r;
    if (trip === 'multicity' && p.get('legs')) {
      var raw = p.get('legs').split(',').map(function (x) { return x.split(':'); }).filter(function (x) { return x.length === 3; });
      legs = raw.map(function (x) { return { from: { code: x[0], label: x[0] }, to: { code: x[1], label: x[1] }, date: x[2] >= today ? x[2] : today }; });
      var lookup = function (code) { return FC.api('GET', '/airports?q=' + encodeURIComponent(code)).then(function (r) { var h = r.airports.filter(function (x) { return x.code === code; })[0]; return h ? { code: h.code, label: h.label } : { code: code, label: code }; }); };
      Promise.all(legs.map(function (l) { return Promise.all([lookup(l.from.code), lookup(l.to.code)]).then(function (c) { l.from = c[0]; l.to = c[1]; }); })).then(function () { if (state.trip === 'multicity') renderLegs(); });
      setTrip('multicity'); return;
    }
    setTrip(trip === 'oneway' ? 'oneway' : 'return');
    if (p.get('from')) fill(fromInput, p.get('from')); if (p.get('to')) fill(toInput, p.get('to'));
  }

  // ---------- deals ----------
  var IMG = {
    DEL: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=400&h=300&fit=crop', BLR: 'https://images.unsplash.com/photo-1595658658481-d53d3f999875?w=400&h=300&fit=crop',
    HYD: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?w=400&h=300&fit=crop', GOI: 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=400&h=300&fit=crop',
    IXL: 'https://images.unsplash.com/photo-1626010448982-4d629fc2b28c?w=400&h=300&fit=crop',
  };
  var TINT = { DEL: 'from-blue-100 to-blue-50', BLR: 'from-green-100 to-green-50', HYD: 'from-amber-100 to-amber-50', GOI: 'from-cyan-100 to-cyan-50', IXL: 'from-slate-200 to-slate-100' };
  FC.api('GET', '/deals?from=BOM').then(function (r) {
    var html = r.deals.map(function (d) {
      var href = '/results.html?' + qsFor({ trip: 'oneway', from: 'BOM', to: d.code, date: d.date, adults: 1, children: 0, infants: 0, cabin: 'Economy' });
      return '<a href="' + href + '" class="lift border border-surface-variant dark:border-slate-600 rounded-xl overflow-hidden group bg-white dark:bg-slate-900 block" aria-label="' + FC.esc(d.city) + ', from ' + FC.money(d.from) + '">' +
        '<div class="h-32 bg-gradient-to-br ' + (TINT[d.code] || 'from-slate-200 to-slate-100') + ' dark:from-slate-700 dark:to-slate-600 relative overflow-hidden"><img src="' + (IMG[d.code] || '') + '" width="400" height="300" loading="lazy" decoding="async" class="w-full h-full object-cover deal-img" alt=""/>' +
        '<div class="absolute top-2 right-2 bg-white/90 dark:bg-slate-900/90 text-on-background dark:text-white text-[10px] font-bold px-2 py-1 rounded-full">' + d.code + '</div></div>' +
        '<div class="p-3"><h3 class="font-bold text-sm">' + FC.esc(d.city) + '</h3><p class="text-[11px] text-on-surface-variant dark:text-slate-400 mt-1">from <span class="font-bold text-primary dark:text-sky-300 text-sm">' + FC.money(d.from) + '</span></p><p class="text-[10px] text-on-surface-variant dark:text-slate-400">' + FC.fmtShort(d.date) + '</p></div></a>';
    }).join('');
    html += '<a href="/offers.html" class="bg-gradient-to-br from-[#005a8f] to-[#0074b6] rounded-xl overflow-hidden text-white flex flex-col justify-between p-4 relative hover:shadow-xl transition-all min-h-[200px]"><div class="absolute top-2 right-2 opacity-20"><span class="material-symbols-outlined text-[64px]" aria-hidden="true">wb_sunny</span></div><div class="relative z-10"><p class="text-[10px] uppercase font-bold tracking-wider mb-1">Summer Sale</p><p class="text-xs mb-1">UP TO</p><h3 class="font-headline-xl text-3xl font-bold leading-none mb-1">40% <span class="text-sm font-normal">OFF</span></h3><p class="text-[10px]">on Domestic Flights</p></div><span class="w-full text-center bg-white text-[#005a8f] font-bold text-sm py-2 rounded mt-4 relative z-10">View Offers</span></a>';
    $('#deals-grid').innerHTML = html; $('#deals-grid').classList.add('stagger');
  }).catch(function () { $('#deals-grid').innerHTML = '<p class="col-span-full text-sm text-on-surface-variant dark:text-slate-300">Deals are unavailable right now. You can still search for any route above.</p>'; });

  // ---------- init ----------
  renderPax(); setTrip('return'); loadRecent();
  var q = FC.qs(); if (q.get('trip') || q.get('from')) prefill(q);
  var promo = FC.store.get('fc_promo', null);
  if (promo && promo.code) {
    var note = document.createElement('p'); note.className = 'mt-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-1';
    note.innerHTML = '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">sell</span> Promo code <strong>' + FC.esc(promo.code) + '</strong> is saved &mdash; it will be applied at checkout. <button type="button" class="underline ml-1" id="drop-promo">Remove</button>';
    form.appendChild(note); $('#drop-promo').addEventListener('click', function () { FC.store.del('fc_promo'); note.remove(); });
  }
})();
