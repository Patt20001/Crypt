/* ============================================================
   NovaWallet — Shared UI (toasts, skeletons, nav, drawer)
   ============================================================ */

/* ============ TOASTS ============ */
const TOAST_STYLES = {
  success: { bg: 'linear-gradient(135deg,#22c55e,#16a34a)', icon: '✓' },
  error:   { bg: 'linear-gradient(135deg,#ef4444,#b91c1c)', icon: '✕' },
  info:    { bg: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', icon: 'ℹ' },
  warn:    { bg: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '!' }
};

function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

function toast(message, type = 'info', duration = 3500) {
  const root = ensureToastRoot();
  const cfg = TOAST_STYLES[type] || TOAST_STYLES.info;
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = cfg.bg;
  el.innerHTML = `<span class="toast-icon">${cfg.icon}</span><span>${message}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-in'));
  setTimeout(() => {
    el.classList.remove('toast-in');
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ============ SKELETON LOADERS ============ */
function skeletonRows(n = 5) {
  return Array.from({ length: n }).map(() => `<div class="skeleton skeleton-row"></div>`).join('');
}
function skeletonCards(n = 3) {
  return Array.from({ length: n }).map(() => `<div class="skeleton skeleton-card"></div>`).join('');
}

/* ============ ANIMATED COUNTER ============ */
function animateNumber(el, to, decimals = 2, duration = 800) {
  if (!el) return;
  const from = Number(el.dataset.value || 0);
  el.dataset.value = to;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = val.toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ============================================================
   NAV CONFIG — single source of truth
   ============================================================ */
const PRIMARY_LINKS = [
  { href: '/dashboard.html', icon: '📊', label: 'Dashboard', key: 'dashboard' },
  { href: '/portfolio.html', icon: '📈', label: 'Portfolio', key: 'portfolio' },
  { href: '/orders.html',    icon: '💹', label: 'Trade',     key: 'orders' },
  { href: '/staking.html',   icon: '🌱', label: 'Stake',     key: 'staking' },
  { href: '/swap.html',      icon: '🔄', label: 'Swap',      key: 'swap' },
  { href: '/wallet.html',    icon: '👛', label: 'Wallet',    key: 'wallet' }
];

const SECONDARY_LINKS = [
  { href: '/networks.html',  icon: '🌐', label: 'Networks',     key: 'networks' },
  { href: '/referrals.html', icon: '🎁', label: 'Refer & Earn', key: 'referrals' },
  { href: '/profile.html',   icon: '👤', label: 'Profile',      key: 'profile' }
];

/* ============================================================
   MODAL HELPERS (available everywhere)
   ============================================================ */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    closeMobileNav();
  }
});

/* ============================================================
   DESKTOP NAV RENDERING
   Replaces whatever is hardcoded in .nav-links on each page
   ============================================================ */
function currentPathKey() {
  const p = window.location.pathname.replace('/', '').replace('.html', '') || 'dashboard';
  return p;
}

function renderTopNav() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const initial = user ? (user.username || '?')[0].toUpperCase() : '?';
  const activeKey = currentPathKey();

  // Build primary links
  const primaryHTML = PRIMARY_LINKS.map(l => `
    <a href="${l.href}" class="nav-link ${activeKey === l.key ? 'active' : ''}">${l.label}</a>
  `).join('');

  // Build secondary links for the user dropdown
  const secondaryHTML = SECONDARY_LINKS.map(l => `
    <a href="${l.href}" class="dropdown-item ${activeKey === l.key ? 'active' : ''}">
      <span class="dropdown-item-icon">${l.icon}</span>
      <span>${l.label}</span>
    </a>
  `).join('');

  const isAdmin = user?.role === 'admin';

  navLinks.innerHTML = `
    ${primaryHTML}

    <div class="theme-toggle" data-action="toggle-theme" title="Toggle theme">🌓</div>

    <div class="notif-wrap">
      <div class="notif-bell" data-notif-toggle>
        🔔
        <span class="notif-badge" style="display:none;"></span>
      </div>
      <div class="notif-panel glass"></div>
    </div>

    <div class="user-wrap">
      <div class="user-chip" data-user-toggle>
        <div class="avatar">${initial}</div>
      </div>
      <div class="user-dropdown glass" id="user-dropdown">
        <div class="dropdown-header">
          <div class="avatar avatar-lg">${initial}</div>
          <div style="min-width:0;">
            <div class="dropdown-name">${user?.username || ''}</div>
            <div class="dropdown-email">${user?.email || ''}</div>
          </div>
        </div>
        ${secondaryHTML}
        ${isAdmin ? `
          <a href="/admin.html" class="dropdown-item">
            <span class="dropdown-item-icon">🛡️</span>
            <span>Admin Panel</span>
          </a>
        ` : ''}
        <div class="dropdown-divider"></div>
        <a href="#" class="dropdown-item danger" data-action="logout">
          <span class="dropdown-item-icon">🚪</span>
          <span>Logout</span>
        </a>
      </div>
    </div>

    <button class="nav-burger" aria-label="Open menu" data-burger>☰</button>
  `;

  // Toggle user dropdown
  navLinks.querySelector('[data-user-toggle]').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-dropdown')?.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('user-dropdown')?.classList.remove('open');
  });

  // Burger
  navLinks.querySelector('[data-burger]').addEventListener('click', (e) => {
    e.stopPropagation();
    openMobileNav();
  });
}

/* ============================================================
   MOBILE NAV DRAWER — includes EVERYTHING
   ============================================================ */
function buildMobileDrawer() {
  const existing = document.getElementById('nav-drawer');
  if (existing) existing.remove();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const initial = user ? (user.username || '?')[0].toUpperCase() : '?';
  const activeKey = currentPathKey();

  const allLinks = [...PRIMARY_LINKS, ...SECONDARY_LINKS];
  if (user?.role === 'admin') {
    allLinks.push({ href: '/admin.html', icon: '🛡️', label: 'Admin Panel', key: 'admin' });
  }

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.id = 'nav-drawer';
  drawer.innerHTML = `
    <div class="nav-drawer-backdrop" onclick="closeMobileNav()"></div>
    <aside class="nav-drawer-panel">
      <div class="nav-drawer-head">
        <div class="brand">
          <div class="brand-logo">₮</div>
          <span>Nova<span class="brand-accent">Wallet</span></span>
        </div>
        <button class="nav-burger" onclick="closeMobileNav()" aria-label="Close">✕</button>
      </div>

      <div class="nav-drawer-user">
        <div class="avatar">${initial}</div>
        <div style="min-width:0; flex:1;">
          <div class="nav-drawer-name">${user?.username || 'Guest'}</div>
          <div class="nav-drawer-email">${user?.email || ''}</div>
        </div>
      </div>

      <nav class="nav-drawer-links">
        ${allLinks.map(l => `
          <a href="${l.href}" class="nav-drawer-link ${activeKey === l.key ? 'active' : ''}">
            <span class="ico">${l.icon}</span>
            <span>${l.label}</span>
          </a>
        `).join('')}
      </nav>

      <div class="nav-drawer-section">
        <button class="nav-drawer-link" data-action="toggle-theme" style="width:100%;">
          <span class="ico">🌓</span>
          <span>Toggle theme</span>
        </button>
        <a href="#" class="nav-drawer-link danger" data-action="logout">
          <span class="ico">🚪</span>
          <span>Logout</span>
        </a>
      </div>
    </aside>
  `;
  document.body.appendChild(drawer);
}

window.openMobileNav = function () {
  buildMobileDrawer();
  requestAnimationFrame(() => {
    document.getElementById('nav-drawer')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
};

window.closeMobileNav = function () {
  const drawer = document.getElementById('nav-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => drawer.remove(), 300);
};

/* ============================================================
   GLOBAL LOGOUT
   ============================================================ */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="logout"]');
  if (el) {
    e.preventDefault();
    if (typeof logout === 'function') logout();
    else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace('/login.html');
    }
  }
});

/* ============================================================
   BACKGROUND BLOBS + INIT
   ============================================================ */
function injectBackground() {
  if (document.querySelector('.bg-blobs')) return;
  const bg = document.createElement('div');
  bg.className = 'bg-blobs';
  bg.innerHTML = '<span></span><span></span><span></span>';
  document.body.prepend(bg);
}

document.addEventListener('DOMContentLoaded', () => {
  injectBackground();
  if (localStorage.getItem('token')) {
    renderTopNav();
  }
});