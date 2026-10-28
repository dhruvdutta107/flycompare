/* FlyCompare - shared front-end helpers (no framework, no inline handlers: works with a strict CSP). */
(function () {
  'use strict';
  var FC = (window.FC = {});
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  FC.$ = $; FC.$$ = $$;

  // ---------- small utils ----------
  FC.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  FC.money = function (n) { return 'Rs ' + Number(n || 0).toLocaleString('en-IN'); };
  FC.fmtDate = function (iso, long) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', long ? { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' } : { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };
  FC.fmtShort = function (iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); };
  FC.todayISO = function () { return new Date().toLocaleDateString('en-CA'); };
  FC.addDays = function (iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  FC.qs = function () { return new URLSearchParams(location.search); };
  FC.store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  FC.airline = {
    '6E': 'bg-indigo-600', AI: 'bg-red-600', QP: 'bg-orange-500', SG: 'bg-rose-700',
  };
  FC.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); };

  // ---------- API ----------
  function ApiError(status, body) {
    this.name = 'ApiError'; this.status = status; this.code = body && body.error; this.message = (body && body.message) || 'Something went wrong. Please try again.'; this.fields = (body && body.fields) || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  // top progress bar: shown while any API request is in flight (visibility of system status)
  var inflight = 0; var barTimer = null;
  function progress(delta) {
    var bar = document.getElementById('fc-progress');
    if (!bar) { bar = document.createElement('div'); bar.id = 'fc-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar); }
    inflight = Math.max(0, inflight + delta); clearTimeout(barTimer);
    if (inflight > 0) { bar.classList.add('active'); bar.style.width = (delta > 0 ? Math.min(85, 25 + inflight * 20) : 85) + '%'; }
    else { bar.style.width = '100%'; barTimer = setTimeout(function () { bar.classList.remove('active'); setTimeout(function () { if (!inflight) bar.style.width = '0'; }, 350); }, 200); }
  }
  FC.api = function (method, url, body, opts) {
    var o = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') { o.headers['Content-Type'] = 'application/json'; o.headers['X-Requested-With'] = 'fetch'; o.body = JSON.stringify(body || {}); }
    var quiet = opts && opts.quiet; if (!quiet) progress(1);
    var done = function () { if (!quiet) progress(-1); };
    return fetch('/api' + url, o).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        done();
        if (!res.ok) throw new ApiError(res.status, data);
        return data;
      });
    }, function () { done(); throw new ApiError(0, { error: 'network', message: 'Cannot reach the server. Check your connection and try again.' }); });
  };

  // ---------- toasts ----------
  /** Toast with a close button and a countdown bar (pauses on hover). opts: {duration, action:{label, href}} */
  FC.toast = function (message, type, opts) {
    type = type || 'info'; opts = opts || {};
    var box = $('#toast-container'); if (!box) return;
    var colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-primary', reminder: 'bg-slate-900 dark:bg-slate-700' };
    var icons = { success: 'check_circle', error: 'error', info: 'info', reminder: 'notifications_active' };
    var ms = opts.duration || (type === 'error' ? 6000 : type === 'reminder' ? 20000 : 3600);
    var t = document.createElement('div');
    t.className = 'toast ' + colors[type] + ' text-white pl-4 pr-2 py-3 rounded-xl shadow-lg flex items-start gap-2 pointer-events-auto slide-up min-w-[220px] max-w-sm';
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = '<span class="material-symbols-outlined text-[20px] mt-px' + (type === 'reminder' ? ' icon-fill' : '') + '" aria-hidden="true">' + icons[type] + '</span>' +
      '<div class="flex-1 min-w-0"><p class="font-medium text-sm">' + FC.esc(message) + '</p>' + (opts.body ? '<p class="text-xs text-white/80 mt-0.5">' + FC.esc(opts.body) + '</p>' : '') +
      (opts.action ? '<a href="' + FC.esc(opts.action.href) + '" class="inline-block mt-1.5 text-xs font-bold underline underline-offset-2">' + FC.esc(opts.action.label) + '</a>' : '') + '</div>' +
      '<button type="button" class="p-1 rounded-md hover:bg-white/15 -mt-0.5" aria-label="Dismiss notification"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span></button>' +
      '<span class="toast-bar" style="animation-duration:' + ms + 'ms" aria-hidden="true"></span>';
    box.appendChild(t);
    var gone = false;
    function close() { if (gone) return; gone = true; t.classList.add('toast-out'); setTimeout(function () { t.remove(); }, 300); }
    $('button', t).addEventListener('click', close);
    $('.toast-bar', t).addEventListener('animationend', close);
    return close;
  };

  // ---------- modals (focus management + Esc) ----------
  var lastFocus = null;
  FC.openModal = function (id) {
    var m = document.getElementById(id); if (!m) return;
    lastFocus = document.activeElement;
    m.classList.remove('hidden'); document.body.style.overflow = 'hidden';
    var card = m.children[1]; if (card) { card.classList.remove('pop-in'); void card.offsetWidth; card.classList.add('pop-in'); }
    var f = $('input, button:not([data-close-modal])', m); if (f && id !== 'mobile-menu') setTimeout(function () { f.focus(); }, 30);
  };
  FC.closeModal = function (id) {
    var m = document.getElementById(id); if (!m) return;
    m.classList.add('hidden');
    if (!$$('[role=dialog]:not(.hidden)').length) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  FC.confirm = function (o) {
    return new Promise(function (resolve) {
      var w = document.createElement('div');
      w.className = 'fixed inset-0 z-[95]'; w.setAttribute('role', 'alertdialog'); w.setAttribute('aria-modal', 'true');
      w.innerHTML = '<div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>' +
        '<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md bg-surface-container-lowest dark:bg-slate-800 rounded-2xl shadow-2xl p-6 border border-surface-variant dark:border-slate-700 pop-in">' +
        '<h2 class="font-headline-md text-headline-md font-bold mb-2">' + FC.esc(o.title) + '</h2><div class="text-sm text-on-surface-variant dark:text-slate-300 mb-6">' + o.html + '</div>' +
        '<div class="flex justify-end gap-3"><button type="button" data-no class="px-4 py-2 rounded-lg border border-surface-variant dark:border-slate-600 font-semibold hover:bg-surface-container-low dark:hover:bg-slate-700">' + FC.esc(o.cancelText || 'Keep it') + '</button>' +
        '<button type="button" data-yes class="px-4 py-2 rounded-lg font-bold text-white ' + (o.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90') + '">' + FC.esc(o.confirmText || 'Confirm') + '</button></div></div>';
      var prev = document.activeElement;
      function done(v) { document.removeEventListener('keydown', onKey, true); w.remove(); document.body.style.overflow = ''; if (prev && prev.focus) prev.focus(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
      document.addEventListener('keydown', onKey, true);
      w.addEventListener('click', function (e) { if (e.target.closest('[data-yes]')) done(true); else if (e.target.closest('[data-no]') || e.target === w.firstChild) done(false); });
      document.body.appendChild(w); document.body.style.overflow = 'hidden'; $('[data-no]', w).focus();
    });
  };

  // ---------- inline validation helpers ----------
  FC.setError = function (root, key, msg) {
    var m = $('[data-msg="' + key + '"]', root); var inp = $('[data-field="' + key + '"], [name="' + key + '"]', root);
    if (m) { m.hidden = !msg; m.innerHTML = msg ? '<span class="material-symbols-outlined text-[14px] mt-[1px]" aria-hidden="true">error</span><span>' + FC.esc(msg) + '</span>' : ''; if (!m.id) m.id = 'msg-' + key.replace(/[^a-z0-9]/gi, '-') + '-' + Math.random().toString(36).slice(2, 6); }
    if (inp) {
      var wrap = inp.closest('.field-wrap');
      inp.classList.toggle('input-error', !!msg && !wrap);
      if (wrap) wrap.classList.toggle('has-error', !!msg);
      if (msg) { inp.setAttribute('aria-invalid', 'true'); if (m) inp.setAttribute('aria-describedby', m.id); } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby'); }
    }
    return inp;
  };
  FC.clearErrors = function (root) { $$('[data-msg]', root).forEach(function (m) { FC.setError(root, m.getAttribute('data-msg'), ''); }); };
  /** Shows every server/client error and moves focus to the first wrong field. */
  FC.applyErrors = function (root, fields) {
    var first = null; FC.clearErrors(root);
    Object.keys(fields || {}).forEach(function (k) { var el = FC.setError(root, k, fields[k]); if (!first && el) first = el; });
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(function () { first.focus({ preventScroll: true }); }, 250);
      var w = first.closest('.field-wrap') || first; w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
    }
    return first;
  };

  // ---------- step indicator ----------
  FC.renderStepper = function () {
    var el = $('#stepper'); if (!el) return;
    var step = Number(el.getAttribute('data-step')); var labels = ['Results', 'Passenger Details', 'Payment', 'Confirmation'];
    var base = el.getAttribute('data-back') || '';
    el.className = 'flex items-center justify-center gap-2 sm:gap-3 mb-8 text-xs sm:text-sm font-semibold flex-wrap';
    el.setAttribute('aria-label', 'Booking progress');
    el.innerHTML = labels.map(function (l, i) {
      var n = i + 1; var state = n < step ? 'done' : n === step ? 'now' : 'todo';
      var color = state === 'todo' ? 'text-on-surface-variant dark:text-slate-400' : 'text-primary dark:text-sky-300';
      var dot = state === 'done' ? '<span class="material-symbols-outlined text-[16px]" aria-hidden="true">check_circle</span>' : '<span class="step-dot ' + (state === 'now' ? 'bg-primary dark:bg-sky-300' : 'bg-surface-variant dark:bg-slate-600') + '" aria-hidden="true"></span>';
      var inner = dot + '<span class="' + (state === 'now' ? 'font-bold' : '') + '">' + l + '</span>';
      var link = state === 'done' && base && step < 4 && el.getAttribute('data-links') ? (el.getAttribute('data-links').split('|')[i] || '') : '';
      var item = link ? '<a href="' + FC.esc(link) + '" class="flex items-center gap-1.5 ' + color + ' hover:underline">' + inner + '</a>' : '<span class="flex items-center gap-1.5 ' + color + '"' + (state === 'now' ? ' aria-current="step"' : '') + '>' + inner + '</span>';
      return item + (i < 3 ? '<span class="w-6 sm:w-10 h-px bg-surface-variant dark:bg-slate-600" aria-hidden="true"></span>' : '');
    }).join('');
  };

  // ---------- theme ----------
  function syncThemeIcon() {
    var dark = document.documentElement.classList.contains('dark');
    $$('[data-theme-icon]').forEach(function (i) { i.textContent = dark ? 'light_mode' : 'dark_mode'; });
  }
  FC.toggleTheme = function () {
    var dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark);
    try { localStorage.setItem('fc_theme', dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
    syncThemeIcon();
  };

  // ---------- nav ----------
  function highlightNav() {
    var key = document.body.getAttribute('data-nav'); if (!key) return;
    $$('[data-nav-link="' + key + '"]').forEach(function (a) {
      a.setAttribute('aria-current', 'page');
      a.classList.remove('text-on-surface-variant', 'border-transparent', 'dark:text-slate-300'); a.classList.add('text-primary', 'dark:text-sky-300', 'border-primary', 'font-bold');
    });
  }
  FC.toggleMenu = function () {
    var m = $('#mobile-menu'); var open = m.classList.contains('hidden');
    if (open) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; var f = $('nav a', m); if (f) setTimeout(function () { f.focus(); }, 60); } else { m.classList.add('hidden'); document.body.style.overflow = ''; }
    $$('[data-toggle-menu][aria-expanded]').forEach(function (b) { b.setAttribute('aria-expanded', String(open)); });
  };

  // ---------- auth ----------
  FC.user = null;
  var authListeners = [];
  FC.onAuth = function (fn) { authListeners.push(fn); if (FC.authLoaded) fn(FC.user); };
  function renderAuth() {
    var area = $('#auth-area'); var mob = $('#mobile-auth-area');
    if (FC.user) {
      var initial = FC.esc(FC.user.name.charAt(0).toUpperCase());
      var first = FC.esc(FC.user.name.split(' ')[0]);
      area.classList.remove('hidden'); area.classList.add('block');
      area.innerHTML = '<div class="relative"><button type="button" data-user-menu class="flex items-center gap-2 font-label-md text-label-md border border-surface-variant dark:border-slate-600 rounded-full pl-1 pr-3 py-1 hover:bg-surface-container-low dark:hover:bg-slate-800" aria-haspopup="true" aria-expanded="false">' +
        '<span class="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold" aria-hidden="true">' + initial + '</span><span class="max-w-[90px] truncate">' + first + '</span><span class="material-symbols-outlined text-[16px]" aria-hidden="true">expand_more</span></button>' +
        '<div data-user-pop hidden class="absolute right-0 mt-2 w-52 bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl shadow-xl py-2 z-50">' +
        '<p class="px-4 pb-2 text-xs text-on-surface-variant dark:text-slate-400 truncate border-b border-surface-variant dark:border-slate-700 mb-1">' + FC.esc(FC.user.email) + '</p>' +
        '<a href="/trips.html" class="block px-4 py-2 text-sm hover:bg-surface-container-low dark:hover:bg-slate-700">My trips</a>' +
        '<button type="button" data-logout class="w-full text-left px-4 py-2 text-sm hover:bg-surface-container-low dark:hover:bg-slate-700">Log out</button></div></div>';
      mob.innerHTML = '<p class="text-sm mb-3">Signed in as <strong>' + FC.esc(FC.user.name) + '</strong></p><button type="button" data-logout class="w-full border border-surface-variant dark:border-slate-600 font-bold py-3 rounded-lg">Log out</button>';
    } else {
      area.classList.add('hidden', 'sm:block'); area.classList.remove('block');
      area.innerHTML = '<button type="button" data-open-auth="login" class="flex items-center gap-xs font-label-md text-label-md text-primary dark:text-sky-300 border border-primary dark:border-sky-300 rounded-full px-4 py-2 hover:bg-primary/5 transition-colors"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">person</span><span>Login / Sign Up</span></button>';
      mob.innerHTML = '<button type="button" data-open-auth="login" class="w-full bg-primary text-on-primary font-bold py-3 rounded-lg flex items-center justify-center gap-2"><span class="material-symbols-outlined text-sm" aria-hidden="true">person</span> Login / Sign Up</button>';
    }
  }
  function setUser(u) { FC.user = u; FC.authLoaded = true; renderAuth(); authListeners.forEach(function (fn) { fn(u); }); }
  FC.loadAuth = function () { return FC.api('GET', '/auth/me').then(function (r) { setUser(r.user); }, function () { setUser(null); }); };
  FC.openAuth = function (mode) {
    switchAuth(mode || 'login');
    if (!$('#mobile-menu').classList.contains('hidden')) FC.toggleMenu();
    FC.openModal('auth-modal');
  };
  /** Resolves with the user once logged in (opens the modal if needed). */
  FC.requireLogin = function () {
    if (FC.user) return Promise.resolve(FC.user);
    return new Promise(function (resolve) { var once = function (u) { if (u) { authListeners.splice(authListeners.indexOf(once), 1); resolve(u); } }; authListeners.push(once); FC.openAuth('login'); });
  };
  function switchAuth(mode) {
    $('#login-form').classList.toggle('hidden', mode !== 'login'); $('#register-form').classList.toggle('hidden', mode !== 'register');
    $('#auth-title').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
    FC.clearErrors($('#auth-modal'));
    var f = $(mode === 'login' ? '#login-email' : '#reg-name'); if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function submitAuth(form) {
    var mode = form.getAttribute('data-auth-form'); var btn = $('button[type=submit]', form);
    var body = {}; $$('input', form).forEach(function (i) { body[i.name] = i.value; });
    var local = {};
    if (mode === 'register' && body.name.trim().length < 2) local.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S{2,}$/.test(body.email.trim())) local.email = 'Enter a valid e-mail address, like you@example.com.';
    if (!body.password) local.password = mode === 'login' ? 'Enter your password.' : 'Choose a password.';
    else if (mode === 'register' && (body.password.length < 8 || !/\d/.test(body.password) || !/[A-Za-z]/.test(body.password))) local.password = 'Use at least 8 characters with a letter and a number.';
    if (Object.keys(local).length) { FC.applyErrors(form, local); return; }
    FC.clearErrors(form); btn.disabled = true;
    FC.api('POST', '/auth/' + mode, body).then(function (r) {
      form.reset(); FC.closeModal('auth-modal'); setUser(r.user);
      FC.toast(mode === 'login' ? 'Welcome back, ' + r.user.name.split(' ')[0] + '!' : 'Account created. Welcome, ' + r.user.name.split(' ')[0] + '!', 'success');
    }).catch(function (e) {
      if (e.fields) FC.applyErrors(form, e.fields); else FC.setError(form, '_form', e.message);
    }).then(function () { btn.disabled = false; });
  }
  FC.logout = function () {
    return FC.api('POST', '/auth/logout').then(function () { setUser(null); FC.toast('You have been logged out.', 'info'); if (document.body.getAttribute('data-page') === 'trips') location.reload(); }, function (e) { FC.toast(e.message, 'error'); });
  };

  // ---------- airport autocomplete (combobox) ----------
  FC.airportInput = function (input, onPick) {
    var list = document.createElement('ul'); var uid = 'ac-' + Math.random().toString(36).slice(2, 7);
    list.id = uid; list.setAttribute('role', 'listbox');
    list.className = 'hidden absolute left-0 right-0 top-full mt-2 z-40 bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-600 rounded-xl shadow-xl max-h-72 overflow-y-auto py-1 min-w-[260px]';
    var host = input.closest('.field-wrap') || input.parentNode; host.appendChild(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', uid); input.setAttribute('aria-expanded', 'false'); input.setAttribute('autocomplete', 'off');
    var items = []; var active = -1; var timer = null; var seq = 0;
    function close() { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); active = -1; }
    function paint() {
      list.innerHTML = items.length ? items.map(function (a, i) {
        return '<li role="option" id="' + uid + '-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '" class="px-4 py-2 cursor-pointer flex justify-between gap-3 items-center ' + (i === active ? 'bg-primary/10' : 'hover:bg-surface-container-low dark:hover:bg-slate-700') + '"><span><span class="block font-semibold text-sm">' + FC.esc(a.city) + '</span><span class="block text-xs text-on-surface-variant dark:text-slate-400">' + FC.esc(a.name) + '</span></span><span class="text-xs font-bold text-primary dark:text-sky-300">' + a.code + '</span></li>';
      }).join('') : '<li class="px-4 py-3 text-sm text-on-surface-variant dark:text-slate-400">No matching airports</li>';
      list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', uid + '-' + active); else input.removeAttribute('aria-activedescendant');
    }
    function pick(a) { input.value = a.label; input.dataset.code = a.code; close(); FC.setError(input.closest('form') || document, input.getAttribute('data-field') || input.name || '', ''); if (onPick) onPick(a); }
    function query() {
      var q = input.value.trim(); var my = ++seq;
      FC.api('GET', '/airports?q=' + encodeURIComponent(q)).then(function (r) { if (my !== seq) return; items = r.airports; active = items.length ? 0 : -1; paint(); }, function () { /* offline: ignore */ });
    }
    input.addEventListener('input', function () { delete input.dataset.code; clearTimeout(timer); timer = setTimeout(query, 120); });
    input.addEventListener('focus', function () { input.select(); query(); });
    input.addEventListener('keydown', function (e) {
      if (list.classList.contains('hidden')) { if (e.key === 'ArrowDown') { query(); e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { active = (active + 1) % items.length; paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
      else if (e.key === 'Tab' && active >= 0 && items[active]) { pick(items[active]); }
    });
    list.addEventListener('mousedown', function (e) { var li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(items[Number(li.dataset.i)]); } });
    document.addEventListener('click', function (e) { if (!host.contains(e.target)) close(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    return { set: function (a) { input.value = a.label; input.dataset.code = a.code; } };
  };

  // ---------- global delegated events ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    var openAuth = t.closest('[data-open-auth]'); if (openAuth) { e.preventDefault(); FC.openAuth(openAuth.getAttribute('data-open-auth')); return; }
    var close = t.closest('[data-close-modal]'); if (close) { FC.closeModal(close.getAttribute('data-close-modal')); return; }
    if (t.closest('[data-toggle-menu]')) { FC.toggleMenu(); return; }
    if (t.closest('[data-toggle-theme]')) { FC.toggleTheme(); return; }
    if (t.closest('[data-logout]')) { FC.logout(); return; }
    var soon = t.closest('[data-coming-soon]'); if (soon) { e.preventDefault(); FC.toast(soon.getAttribute('data-coming-soon') + ' is coming soon - this version covers flights only.', 'info'); return; }
    var sw = t.closest('[data-auth-switch]'); if (sw) { switchAuth(sw.getAttribute('data-auth-switch')); return; }
    var um = t.closest('[data-user-menu]');
    var pop = $('[data-user-pop]');
    if (um && pop) { pop.hidden = !pop.hidden; um.setAttribute('aria-expanded', String(!pop.hidden)); return; }
    if (pop && !pop.hidden && !t.closest('[data-user-pop]')) pop.hidden = true;
  });
  document.addEventListener('submit', function (e) { var f = e.target.closest('[data-auth-form]'); if (f) { e.preventDefault(); submitAuth(f); } });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('#auth-modal:not(.hidden)').forEach(function () { FC.closeModal('auth-modal'); });
    if (!$('#mobile-menu').classList.contains('hidden')) FC.toggleMenu();
    var pop = $('[data-user-pop]'); if (pop) pop.hidden = true;
  });
  // broken remote images fall back to the gradient behind them
  document.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') e.target.style.display = 'none'; }, true);

  // ---------- motion helpers ----------
  FC.motion = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var revealObserver = null;
  /** Fades/slides elements marked .reveal into view as they scroll in (no-op with reduced motion). */
  FC.reveal = function (root) {
    var els = $$('.reveal:not(.is-visible)', root || document);
    if (!FC.motion || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-visible'); }); return; }
    if (!revealObserver) revealObserver = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-visible'); revealObserver.unobserve(en.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (e) { revealObserver.observe(e); });
  };
  /** Animated number (prices, counters). */
  FC.countUp = function (el, to, fmt) {
    fmt = fmt || function (n) { return String(Math.round(n)); };
    if (!FC.motion) { el.textContent = fmt(to); return; }
    var from = Number(el.getAttribute('data-val')) || 0; var t0 = performance.now(); var dur = 600; el.setAttribute('data-val', to);
    (function step(t) { var k = Math.min(1, (t - t0) / dur); var e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
  };
  function onScroll() { var h = $('header'); if (h) h.classList.toggle('is-scrolled', window.scrollY > 8); }

  // ---------- trip reminders (fire while the site is open; calendar file covers the rest) ----------
  var REM_KEY = 'fc_reminders';
  FC.ctx = FC.ctx || {};
  FC.reminders = {
    all: function () { return FC.store.get(REM_KEY, {}); },
    /** token given: replace that booking's reminders with `list`. token null: merge `list` in (account-wide sync). */
    sync: function (list, token) {
      var cur = FC.reminders.all(); var next = {};
      Object.keys(cur).forEach(function (id) { var r = cur[id]; if (!token || r.token !== token) next[id] = r; });
      (list || []).forEach(function (r) { next[r.id] = { id: r.id, title: r.title, body: r.body, at: r.remindAt, token: r.token, fired: cur[r.id] ? cur[r.id].fired : false }; });
      FC.store.set(REM_KEY, next); FC.reminders.check();
    },
    check: function () {
      var cur = FC.reminders.all(); var now = Date.now(); var changed = false;
      Object.keys(cur).forEach(function (id) {
        var r = cur[id];
        if (r.at < now - 2 * 86400000) { delete cur[id]; changed = true; return; }
        if (r.fired || r.at > now) return;
        r.fired = true; changed = true;
        if (r.at < now - 6 * 3600000) return; // too old to be useful
        FC.toast(r.title, 'reminder', { body: r.body, action: { label: 'Open e-ticket', href: '/confirmation.html?b=' + encodeURIComponent(r.token) } });
        if (window.Notification && Notification.permission === 'granted') { try { new Notification(r.title, { body: r.body, tag: 'fc-' + r.id, icon: '/favicon.svg' }); } catch (e) { /* some browsers only allow SW notifications */ } }
      });
      if (changed) FC.store.set(REM_KEY, cur);
    },
    /** Ask for notification permission (must be called from a click). Resolves 'granted' | 'denied' | 'default' | 'unsupported'. */
    permission: function (ask) {
      if (!window.Notification) return Promise.resolve('unsupported');
      if (!ask || Notification.permission !== 'default') return Promise.resolve(Notification.permission);
      return Promise.resolve(Notification.requestPermission()).then(function (p) { return p || Notification.permission; });
    },
  };

  function init() {
    if (FC.motion) document.documentElement.classList.add('motion-ok');
    syncThemeIcon(); highlightNav(); FC.renderStepper(); FC.loadAuth(); FC.reveal();
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    FC.reminders.check(); setInterval(FC.reminders.check, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) FC.reminders.check(); });
    FC.onAuth(function (u) { if (u) FC.api('GET', '/me/reminders', null, { quiet: true }).then(function (r) { FC.reminders.sync(r.reminders, null); }, function () { /* ignore */ }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
