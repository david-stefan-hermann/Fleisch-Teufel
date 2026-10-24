// Applies the saved app theme before the first paint, so a dark app never flashes light (and back).
// Same keys and rules as src/lib/appearance.ts, which takes over once the app runs.
(function () {
  var systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = null;
  try {
    theme = localStorage.getItem('ft.theme');
  } catch (e) {
    // Storage blocked: follow the system.
  }
  var dark = theme === 'dark' || (theme !== 'light' && systemDark);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
  // A forced theme also colors the status bar right away (the metas follow the system otherwise).
  if (theme === 'dark' || theme === 'light') {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', dark ? '#151312' : '#faf8f6');
  }
})();
