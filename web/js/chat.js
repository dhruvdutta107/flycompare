/* Customer-service chat widget (on every page). Talks to POST /api/assistant; the server grounds answers in real
   booking / flight-status / transfer data and uses Claude when an API key is configured. */
(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$;
  var fab = $('#chat-fab'); var panel = $('#chat-panel'); var log = $('#chat-log'); var form = $('#chat-form');
  var input = $('#chat-input'); var send = $('#chat-send'); var chips = $('#chat-suggest');
  if (!fab || !panel) return;
  var KEY = 'fc_chat';
  var state = load();
  var busy = false;
  var START = ['Track my flight', 'Cab or bus from the airport', 'Cancellation & refund', 'Set a trip reminder', 'Baggage allowance', 'Talk to a human'];

  function load() { try { var s = JSON.parse(sessionStorage.getItem(KEY)); if (s && Array.isArray(s.messages)) return s; } catch (e) { /* ignore */ } return { messages: [], suggestions: START }; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ messages: state.messages.slice(-30), suggestions: state.suggestions })); } catch (e) { /* ignore */ } }

  // ---------- rendering ----------
  function format(text) {
    var lines = FC.esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split('\n');
    var html = ''; var inList = false;
    lines.forEach(function (l) {
      var m = /^\s*[-•]\s+(.*)$/.exec(l);
      if (m) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + m[1] + '</li>'; return; }
      if (inList) { html += '</ul>'; inList = false; }
      html += l.trim() ? '<p>' + l + '</p>' : '';
    });
    return html + (inList ? '</ul>' : '');
  }
  var safeHref = function (h) { return /^\/[A-Za-z0-9._~\/?=&%#:+-]*$/.test(h) && h.indexOf('//') !== 0 ? h : '#'; };

  function bubble(m, animate) {
    var row = document.createElement('div');
    var mine = m.role === 'user';
    row.className = 'flex gap-2 ' + (mine ? 'justify-end' : 'justify-start') + (animate ? ' chat-msg' : '');
    var acts = (m.actions || []).map(function (a) { return '<a href="' + FC.esc(safeHref(a.href)) + '" class="press inline-flex items-center gap-1 text-xs font-bold text-primary dark:text-sky-300 bg-primary/10 dark:bg-sky-400/10 hover:bg-primary/20 rounded-full px-3 py-1.5 mt-2 mr-1.5">' + FC.esc(a.label) + '<span class="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span></a>'; }).join('');
    row.innerHTML = (mine ? '' : '<span class="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary dark:text-sky-300 flex items-center justify-center mt-0.5" aria-hidden="true"><span class="material-symbols-outlined icon-fill text-[16px]">support_agent</span></span>') +
      '<div class="chat-bubble max-w-[82%] text-sm leading-relaxed space-y-1 px-3.5 py-2.5 rounded-2xl ' +
      (mine ? 'bg-primary text-white rounded-br-md' : m.error ? 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-900 rounded-bl-md' : 'bg-white dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-bl-md shadow-sm') + '">' +
      '<span class="sr-only">' + (mine ? 'You said: ' : 'Assistant: ') + '</span>' + format(m.content) + (acts ? '<div>' + acts + '</div>' : '') +
      (m.error ? '<button type="button" data-retry class="mt-1 text-xs font-bold underline">Try again</button>' : '') + '</div>';
    log.appendChild(row);
    return row;
  }
  function renderChips() {
    chips.innerHTML = (state.suggestions || []).map(function (s) { return '<button type="button" data-chip class="shrink-0 text-xs font-semibold border border-primary/40 text-primary dark:text-sky-300 dark:border-sky-300/40 rounded-full px-3 py-1.5 hover:bg-primary hover:text-white dark:hover:text-slate-900 dark:hover:bg-sky-300">' + FC.esc(s) + '</button>'; }).join('');
    chips.hidden = !state.suggestions || !state.suggestions.length;
  }
  function renderAll() {
    log.innerHTML = '';
    state.messages.forEach(function (m) { if (m.kind === 'handoff') handoffForm(m, false); else bubble(m, false); });
    renderChips(); scroll();
  }
  function scroll() { log.scrollTo({ top: log.scrollHeight, behavior: FC.motion ? 'smooth' : 'auto' }); }
  var typingEl = null;
  function typing(on) {
    if (on && !typingEl) {
      typingEl = document.createElement('div'); typingEl.className = 'flex gap-2 chat-msg';
      typingEl.innerHTML = '<span class="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary dark:text-sky-300 flex items-center justify-center" aria-hidden="true"><span class="material-symbols-outlined icon-fill text-[16px]">support_agent</span></span><div class="typing text-on-surface-variant dark:text-slate-400 bg-white dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-2xl rounded-bl-md px-4 py-3 flex gap-1" role="status" aria-label="Assistant is typing"><span></span><span></span><span></span></div>';
      log.appendChild(typingEl); scroll();
    } else if (!on && typingEl) { typingEl.remove(); typingEl = null; }
  }

  // ---------- human hand-off: a small form inside the chat that creates a support ticket ----------
  function handoffForm(m, animate) {
    var wrap = document.createElement('div'); wrap.className = 'bg-white dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-2xl p-4 shadow-sm' + (animate ? ' chat-msg' : '');
    if (m.ticket) { wrap.innerHTML = '<p class="text-sm flex items-center gap-2"><span class="material-symbols-outlined text-emerald-600 icon-fill" aria-hidden="true">task_alt</span> Ticket <strong>' + FC.esc(m.ticket) + '</strong> created. An agent will e-mail you.</p>'; log.appendChild(wrap); return; }
    var summary = state.messages.filter(function (x) { return x.role === 'user'; }).map(function (x) { return x.content; }).slice(-4).join(' | ');
    var u = FC.user || {};
    wrap.innerHTML = '<form novalidate class="space-y-2.5" data-handoff><p class="font-bold text-sm">Contact a human agent</p>' +
      '<div><label class="block text-xs font-semibold mb-1" for="ho-name">Name</label><input id="ho-name" name="name" autocomplete="name" value="' + FC.esc(u.name || '') + '" class="w-full text-sm rounded-lg border border-surface-variant dark:border-slate-600 bg-transparent px-3 py-2"/><p class="field-msg" data-msg="name" hidden></p></div>' +
      '<div><label class="block text-xs font-semibold mb-1" for="ho-email">E-mail</label><input id="ho-email" name="email" type="email" autocomplete="email" value="' + FC.esc(u.email || '') + '" class="w-full text-sm rounded-lg border border-surface-variant dark:border-slate-600 bg-transparent px-3 py-2"/><p class="field-msg" data-msg="email" hidden></p></div>' +
      '<div><label class="block text-xs font-semibold mb-1" for="ho-msg">What do you need help with?</label><textarea id="ho-msg" name="message" rows="3" maxlength="2000" class="w-full text-sm rounded-lg border border-surface-variant dark:border-slate-600 bg-transparent px-3 py-2">' + FC.esc(summary) + '</textarea><p class="field-msg" data-msg="message" hidden></p></div>' +
      '<p class="field-msg" data-msg="_form" hidden></p><button type="submit" class="w-full bg-primary text-white font-bold text-sm py-2.5 rounded-lg">Send to support</button></form>';
    log.appendChild(wrap);
    var f = $('form', wrap);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { name: f.name.value.trim(), email: f.email.value.trim(), message: f.message.value.trim() }; var errs = {};
      if (body.name.length < 2) errs.name = 'Please enter your name.';
      if (!/^\S+@\S+\.\S{2,}$/.test(body.email)) errs.email = 'Enter a valid e-mail address.';
      if (body.message.length < 10) errs.message = 'Please add a little more detail (10+ characters).';
      if (Object.keys(errs).length) { FC.applyErrors(f, errs); return; }
      var btn = $('button', f); btn.disabled = true; btn.textContent = 'Sending...';
      FC.api('POST', '/support', body).then(function (r) {
        m.ticket = r.ticket; save(); wrap.remove(); handoffForm(m, true);
        push({ role: 'assistant', content: 'Thanks! Your ticket number is **' + r.ticket + '**. Our team usually replies within a few hours.' });
      }, function (err) { btn.disabled = false; btn.textContent = 'Send to support'; if (err.fields) FC.applyErrors(f, err.fields); else FC.setError(f, '_form', err.message); });
    });
  }

  function push(m) { state.messages.push(m); save(); if (m.kind === 'handoff') handoffForm(m, true); else bubble(m, true); scroll(); }

  // ---------- talking to the server ----------
  function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    push({ role: 'user', content: text.slice(0, 800) });
    input.value = ''; resize(); toggleSend();
    state.suggestions = []; renderChips();
    busy = true; typing(true);
    var t0 = Date.now();
    var history = state.messages.filter(function (m) { return (m.role === 'user' || m.role === 'assistant') && !m.error && !m.local; }).map(function (m) { return { role: m.role, content: m.content }; }).slice(-12);
    FC.api('POST', '/assistant', { messages: history, context: { bookingToken: FC.ctx && FC.ctx.bookingToken, page: document.body.getAttribute('data-page') } }, { quiet: true })
      .then(function (r) {
        return new Promise(function (res) { setTimeout(function () { res(r); }, Math.max(0, 550 - (Date.now() - t0))); });
      })
      .then(function (r) {
        typing(false);
        push({ role: 'assistant', content: r.reply, actions: r.actions });
        if (r.handoff) push({ role: 'system', kind: 'handoff' });
        state.suggestions = r.suggestions || []; renderChips(); save();
        if (panel.hidden) badge(true);
      }, function (e) {
        typing(false);
        push({ role: 'assistant', content: e.status === 429 ? e.message : 'Sorry, I could not reach the help desk just now. ' + (e.status === 0 ? 'Check your connection.' : ''), error: true, retry: text });
      })
      .then(function () { busy = false; toggleSend(); });
  }

  // ---------- open / close ----------
  function badge(on) { $('#chat-unread').hidden = !on; }
  function open() {
    panel.hidden = false; panel.classList.remove('chat-open'); void panel.offsetWidth; panel.classList.add('chat-open');
    fab.setAttribute('aria-expanded', 'true'); $('[data-fab-icon]', fab).textContent = 'close'; $('[data-fab-label]', fab).textContent = 'Close';
    if (window.matchMedia('(max-width: 639px)').matches) fab.hidden = true;
    badge(false); FC.store.set('fc_chat_seen', 1);
    if (!state.messages.length) {
      var first = FC.user ? FC.user.name.split(' ')[0] : '';
      push({ role: 'assistant', local: true, content: 'Hi' + (first ? ' ' + first : '') + '! 👋 I\'m the FlyCompare Assistant. I can **track a flight**, find a **cab or bus** from the airport, explain **refunds**, set **trip reminders** or look up your booking.\nHow can I help?' });
      state.suggestions = START; renderChips(); save();
    }
    renderAll();
    setTimeout(function () { input.focus(); }, 80);
  }
  function close() {
    panel.hidden = true; fab.hidden = false; fab.setAttribute('aria-expanded', 'false');
    $('[data-fab-icon]', fab).textContent = 'support_agent'; $('[data-fab-label]', fab).textContent = 'Need help?';
    fab.focus();
  }
  FC.openChat = function (prefill) { if (panel.hidden) open(); if (prefill) ask(prefill); };

  fab.addEventListener('click', function () { if (panel.hidden) open(); else close(); });
  $('#chat-close').addEventListener('click', close);
  $('#chat-reset').addEventListener('click', function () { state = { messages: [], suggestions: START }; save(); log.innerHTML = ''; open(); });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  chips.addEventListener('click', function (e) { var b = e.target.closest('[data-chip]'); if (b) ask(b.textContent); });
  log.addEventListener('click', function (e) {
    var r = e.target.closest('[data-retry]'); if (!r) return;
    var last = state.messages.filter(function (m) { return m.error; }).pop();
    state.messages = state.messages.filter(function (m) { return !m.error; });
    var lastUser = state.messages.pop(); save(); renderAll(); ask(last && last.retry || (lastUser && lastUser.content));
  });
  document.addEventListener('click', function (e) { var t = e.target.closest('[data-open-chat]'); if (t) { e.preventDefault(); FC.openChat(t.getAttribute('data-open-chat') || ''); } });

  function resize() { input.style.height = 'auto'; input.style.height = Math.min(112, input.scrollHeight) + 'px'; }
  function toggleSend() { send.disabled = busy || !input.value.trim(); }
  input.addEventListener('input', function () { resize(); toggleSend(); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });

  // keep the button clear of sticky bottom bars (results page trip bar)
  function offset() {
    var bar = $('#trip-bar'); var h = bar && !bar.classList.contains('hidden') ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--fab-offset', h + 'px');
  }
  var bar = $('#trip-bar');
  if (bar && window.MutationObserver) { new MutationObserver(offset).observe(bar, { attributes: true, attributeFilter: ['class'] }); window.addEventListener('resize', offset); offset(); }

  FC.api('GET', '/assistant/info', null, { quiet: true }).then(function (r) { if (r.ai) $('#chat-sub').innerHTML = 'Online &middot; AI-powered, grounded in your booking'; }, function () { /* ignore */ });
  if (!FC.store.get('fc_chat_seen', 0)) setTimeout(function () { if (panel.hidden) badge(true); }, 4000);
})();
