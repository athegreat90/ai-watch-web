// Applies the saved theme before first paint. External file because the CSP forbids inline scripts.
(function () {
  var themes = ['amoled', 'dark', 'light'];
  var theme = 'amoled';
  try {
    var saved = localStorage.getItem('aiw.theme');
    if (saved === 'system') {
      theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } else if (themes.indexOf(saved) !== -1) {
      theme = saved;
    }
  } catch (e) {
    // Storage blocked: keep the AMOLED default.
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-bs-theme', theme === 'light' ? 'light' : 'dark');
})();
