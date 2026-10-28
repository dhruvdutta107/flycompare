// Runs in <head> before first paint so there is no light/dark flash.
(function () {
  try {
    var saved = localStorage.getItem('fc_theme');
    var dark = saved ? saved === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  } catch (e) { /* storage blocked - stay light */ }
})();
