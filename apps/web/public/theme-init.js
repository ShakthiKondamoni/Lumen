// Pre-paint theme/density/motion — external file so the strict CSP
// (script-src 'self') allows it. Runs before the app bundle to avoid
// any flash of the wrong theme.
(function () {
  try {
    var raw = localStorage.getItem('lumen.appearance');
    var theme = 'paper';
    var density = 'comfortable';
    var motion = '0';
    if (raw) {
      var v = JSON.parse(raw);
      if (['paper', 'graphite', 'midnight', 'system'].includes(v.theme)) theme = v.theme;
      if (['compact', 'comfortable'].includes(v.density)) density = v.density;
      motion = v.reducedMotion ? '1' : '0';
    }
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'paper';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
    root.setAttribute('data-reduced-motion', motion);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'paper');
  }
})();
