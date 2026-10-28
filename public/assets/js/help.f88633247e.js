(function () {
  'use strict';
  var FC = window.FC; var $ = FC.$;
  var FAQS = [
    ['How do I know I am getting the best fare?', 'Results can be sorted by cheapest, fastest or earliest, filtered by airline, stops, departure time and price, and the flexible-dates strip shows the cheapest fare for the days around your date.'],
    ['Can I get a refund if my plans change?', 'Yes. You can cancel from My Trips. More than 24 hours before departure you get a full refund minus Rs 250 per passenger per flight; within 24 hours, 50% minus the same fee. The exact refund is shown once you cancel.'],
    ['Are there any hidden charges?', 'No. The fare summary on the payment page breaks the price into base fare and taxes, shows any promo discount, and the total never changes after that.'],
    ['How long is my fare held?', 'Once you choose flights we lock the fare for 20 minutes while you enter passenger details and pay. A timer on each step shows what is left.'],
    ['How do I find my booking later?', 'Log in and open My Trips, or use "Find a booking" with your 6-character PNR and the e-mail you entered on the passenger page.'],
    ['Can FlyCompare remind me about my flight?', 'Yes. Open your e-ticket and switch on a web check-in reminder (24 hours before), a "leave for the airport" reminder (3 hours before) or a custom one. Reminders pop up while FlyCompare is open; use "Add to calendar" to get alarms on your phone too.'],
    ['How do I get from the airport to the city?', 'The Cab & Bus page shows app cabs, prepaid taxis, airport buses and metro for your arrival time, including whether public transport is still running late at night. Your e-ticket also shows a summary for the airport you land at.'],
    ['Can I track my flight live?', 'Yes - use Track Flight with the flight number, or press Track on your e-ticket. You will see the gate, delays, the plane\'s position on a map and the expected landing time.'],
    ['Are payments and flights real?', 'No - FlyCompare is a coursework project. Fares are simulated, and the payment step is a demo that never moves money. Use the test card shown on the payment page.'],
  ];
  $('#faq-list').innerHTML = FAQS.map(function (f, i) {
    return '<div class="border border-surface-variant dark:border-slate-700 rounded-lg overflow-hidden"><h3><button type="button" data-faq="' + i + '" id="faq-btn-' + i + '" aria-expanded="false" aria-controls="faq-c-' + i + '" class="w-full flex justify-between items-center text-left px-4 py-3 font-semibold hover:bg-surface-container-low dark:hover:bg-slate-700/50"><span>' + f[0] + '</span><span class="material-symbols-outlined text-on-surface-variant transition-transform" aria-hidden="true">expand_more</span></button></h3>' +
      '<div id="faq-c-' + i + '" role="region" aria-labelledby="faq-btn-' + i + '" class="accordion-content px-4"><p class="text-on-surface-variant dark:text-slate-300 text-sm pb-4">' + f[1] + '</p></div></div>';
  }).join('');
  $('#faq-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-faq]'); if (!b) return; var open = b.getAttribute('aria-expanded') === 'true';
    FC.$$('[data-faq]').forEach(function (x) { x.setAttribute('aria-expanded', 'false'); x.querySelector('.material-symbols-outlined').style.transform = ''; $('#' + x.getAttribute('aria-controls')).style.maxHeight = '0px'; });
    if (!open) { b.setAttribute('aria-expanded', 'true'); b.querySelector('.material-symbols-outlined').style.transform = 'rotate(180deg)'; var c = $('#' + b.getAttribute('aria-controls')); c.style.maxHeight = c.scrollHeight + 'px'; }
  });
  var form = $('#contact-form');
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var body = { name: $('#c-name').value.trim(), email: $('#c-email').value.trim(), message: $('#c-message').value.trim() }; var errs = {};
    if (body.name.length < 2) errs.name = 'Please enter your name.';
    if (!/^\S+@\S+\.\S{2,}$/.test(body.email)) errs.email = 'Enter a valid e-mail address.';
    if (body.message.length < 10) errs.message = 'Please tell us a little more (at least 10 characters).';
    if (Object.keys(errs).length) { FC.applyErrors(form, errs); return; }
    FC.clearErrors(form); var btn = $('button[type=submit]', form); btn.disabled = true;
    FC.api('POST', '/support', body).then(function (r) { form.reset(); FC.toast('Message sent! Your ticket is ' + r.ticket + '.', 'success'); })
      .catch(function (err) { if (err.fields) FC.applyErrors(form, err.fields); else FC.setError(form, '_form', err.message); }).then(function () { btn.disabled = false; });
  });
  if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); }
})();
