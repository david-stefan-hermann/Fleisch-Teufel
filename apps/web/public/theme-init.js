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
})();
