(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$;
  FC.api('GET', '/offers').then(function (r) {
    $('#offers-grid').innerHTML = r.offers.map(function (o) {
      return '<article class="bg-surface-container-lowest dark:bg-slate-800 border border-surface-variant dark:border-slate-700 rounded-xl p-6 shadow-sm flex flex-col"><span class="material-symbols-outlined text-primary dark:text-sky-300 text-[32px]" aria-hidden="true">' + o.icon + '</span>' +
        '<p class="text-xs font-bold uppercase text-on-surface-variant dark:text-slate-400 mt-3">' + FC.esc(o.tag) + '</p><h2 class="font-headline-lg text-headline-lg text-primary dark:text-sky-300">' + FC.esc(o.headline) + '</h2>' +
        '<p class="text-sm text-on-surface-variant dark:text-slate-300 mt-2 mb-4 flex-1">' + FC.esc(o.description) + '</p>' +
        '<div class="flex items-center justify-between border-2 border-dashed border-primary/50 rounded-lg px-3 py-2 mb-3"><span class="font-mono font-bold tracking-widest">' + o.code + '</span><button type="button" data-copy="' + o.code + '" class="text-xs font-bold text-primary dark:text-sky-300 hover:underline">Copy</button></div>' +
        '<button type="button" data-apply="' + o.code + '" class="w-full bg-primary text-on-primary font-bold py-2.5 rounded-lg hover:bg-primary/90">Apply &amp; Search</button></article>';
    }).join('');
  }).catch(function (e) { $('#offers-grid').innerHTML = '<p class="text-red-700">' + FC.esc(e.message) + '</p>'; });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]'); var a = e.target.closest('[data-apply]');
    if (c) { (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.copy) : Promise.reject()).then(function () { FC.toast(c.dataset.copy + ' copied', 'success'); }, function () { FC.toast('Code: ' + c.dataset.copy, 'info'); }); }
    if (a) { FC.store.set('fc_promo', { code: a.dataset.apply }); FC.toast(a.dataset.apply + ' saved - now pick your flight.', 'success'); setTimeout(function () { location.href = '/'; }, 700); }
  });
})();
