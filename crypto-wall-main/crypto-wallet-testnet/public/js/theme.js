(function () {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = saved;
})();

function _applyTheme(next) {
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
  if (typeof toast === 'function') {
    toast(`${next === 'dark' ? '🌙 Dark' : '☀️ Light'} mode`, 'info', 1500);
  }
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  _applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// Attach once, at document level, so it works on every page
// regardless of which other scripts loaded.
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action="toggle-theme"]');
  if (el) {
    e.preventDefault();
    toggleTheme();
  }
});