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
  { href: '/copy.html',      icon: '👥', label: 'Copy',      key: 'copy' },
  { href: '/staking.html',   icon: '🌱', label: 'Stake',     key: 'staking' },
  { href: '/swap.html',      icon: '🔄', label: 'Swap',      key: 'swap' },
  { href: '/wallet.html',    icon: '👛', label: 'Wallet',    key: 'wallet' }
];

const SECONDARY_LINKS = [
  { href: '/networks.html',  icon: '🌐', label: 'Networks',     key: 'networks' },
  { href: '/referrals.html', icon: '🎁', label: 'Refer & Earn', key: 'referrals' },
  { href: '/profile.html',   icon: '👤', label: 'Profile',      key: 'profile' },
  { href: '/settings.html',  icon: '⚙️', label: 'Settings',     key: 'settings' },
  { href: '/faq.html',       icon: '❓', label: 'Help & FAQ',   key: 'faq' }
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

  const primaryHTML = PRIMARY_LINKS.map(l => `
    <a href="${l.href}" class="nav-link ${activeKey === l.key ? 'active' : ''}">${l.label}</a>
  `).join('');

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
      <div class="user-chip" data-user-toggle title="Menu">
        <div class="avatar">${initial}</div>
        <span class="user-caret">▾</span>
      </div>
      <div class="user-dropdown glass" id="user-dropdown">
        <a href="/profile.html" class="dropdown-header" style="text-decoration: none; color: inherit;">
          <div class="avatar avatar-lg">${initial}</div>
          <div style="min-width:0; flex:1;">
            <div class="dropdown-name">${user?.username || ''}</div>
            <div class="dropdown-email">${user?.email || ''}</div>
          </div>
          <span style="color: var(--text-mute); font-size: 14px;">›</span>
        </a>
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

  // Toggle user dropdown on chip click
  navLinks.querySelector('[data-user-toggle]').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    document.getElementById('user-dropdown')?.classList.toggle('open');
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    document.getElementById('user-dropdown')?.classList.remove('open');
  });

  // Burger for mobile
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

      <a href="/profile.html" class="nav-drawer-user" style="text-decoration: none; color: inherit;">
        <div class="avatar">${initial}</div>
        <div style="min-width:0; flex:1;">
          <div class="nav-drawer-name">${user?.username || 'Guest'}</div>
          <div class="nav-drawer-email">${user?.email || ''}</div>
        </div>
        <span style="color: var(--text-mute); font-size: 14px;">›</span>
      </a>

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

/* ============================================================
   SHARED HELPERS: escaping, empty states, confirmation dialogs
   ============================================================ */
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Consistent empty state. action = { label, href } optional. */
function emptyState(icon, title, sub = '', action = null) {
  return `<div class="empty empty-rich">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${escHtml(title)}</div>
    ${sub ? `<div class="empty-sub">${escHtml(sub)}</div>` : ''}
    ${action ? `<a class="btn sm" href="${escHtml(action.href)}">${escHtml(action.label)}</a>` : ''}
  </div>`;
}

/* Consistent confirmation dialog for money and security actions.
   confirmAction({ title, message, details: [[label, value]], confirmText, danger, input: { label, placeholder, type, maxlength, inputmode } })
   Resolves: false/null when cancelled; true when confirmed; the entered text when `input` is used. */
function confirmAction(opts = {}) {
  const { title = 'Please confirm', message = '', details = [], confirmText = 'Confirm', cancelText = 'Cancel', danger = false, input = null } = opts;
  return new Promise(resolve => {
    document.getElementById('confirm-modal')?.remove();
    const m = document.createElement('div');
    m.className = 'modal open'; m.id = 'confirm-modal';
    m.innerHTML = `
      <div class="modal-inner glass confirm-dialog" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${escHtml(title)}</h3><button class="modal-close" data-cancel aria-label="Close">×</button></div>
        ${message ? `<p class="confirm-msg">${escHtml(message)}</p>` : ''}
        ${details.length ? `<div class="confirm-details">${details.map(([k, v]) => `<div><span class="tag">${escHtml(k)}</span><b>${escHtml(v)}</b></div>`).join('')}</div>` : ''}
        ${input ? `<label for="confirm-input">${escHtml(input.label || '')}</label>
          <input id="confirm-input" type="${escHtml(input.type || 'text')}" placeholder="${escHtml(input.placeholder || '')}" ${input.maxlength ? `maxlength="${Number(input.maxlength)}"` : ''} ${input.inputmode ? `inputmode="${escHtml(input.inputmode)}"` : ''} autocomplete="one-time-code" />
          <div class="error" id="confirm-error" style="display:none;margin-top:8px;"></div>` : ''}
        <div class="confirm-actions">
          <button class="secondary" data-cancel>${escHtml(cancelText)}</button>
          <button class="${danger ? 'danger' : ''}" data-ok>${escHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const field = m.querySelector('#confirm-input');
    (field || m.querySelector('[data-ok]')).focus();

    const done = value => { document.removeEventListener('keydown', onKey, true); m.remove(); resolve(value); };
    const submit = () => {
      if (!field) return done(true);
      const v = field.value.trim();
      if (!v && input.required !== false) {
        const err = m.querySelector('#confirm-error');
        err.textContent = `${input.label || 'This field'} is required`; err.style.display = 'block'; field.focus(); return;
      }
      done(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', e => { if (e.target === m) done(null); });
    m.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => done(null)));
    m.querySelector('[data-ok]').addEventListener('click', submit);
  });
}

/* Button busy state helper: await withBusy(btn, 'Working…', async () => {...}) */
async function withBusy(btn, busyText, fn) {
  if (!btn) return fn();
  if (btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = busyText;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = original; }
}

/* ============================================================
   PASSWORD FIELDS: show/hide toggle + strength feedback
   ============================================================ */
function passwordStrength(pw) {
  pw = String(pw || '');
  const checks = {
    length: pw.length >= 8,
    long: pw.length >= 12,
    mixed: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw)
  };
  const common = /^(password|123456|12345678|qwerty|letmein|admin|welcome|iloveyou)/i.test(pw) || /^(.)\1+$/.test(pw);
  let score = 0;
  if (checks.length) score++;
  if (checks.long || (checks.mixed && checks.number)) score++;
  if ((checks.mixed ? 1 : 0) + (checks.number ? 1 : 0) + (checks.symbol ? 1 : 0) >= 2) score++;
  if (checks.long && checks.mixed && checks.number && checks.symbol) score++;
  if (pw.length < 10) score = Math.min(score, 2);
  if (!checks.length || common) score = Math.min(score, 1);
  if (!pw) score = 0;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const tips = [];
  if (!checks.length) tips.push('at least 8 characters');
  if (!checks.mixed) tips.push('upper and lower case letters');
  if (!checks.number) tips.push('a number');
  if (!checks.symbol) tips.push('a symbol');
  if (!checks.long) tips.push('12+ characters for extra strength');
  return { score, label: pw ? labels[score] : '', tips, ok: checks.length && !common };
}

function enhancePasswordField(input) {
  if (input.dataset.pwEnhanced) return;
  input.dataset.pwEnhanced = '1';
  const wrap = document.createElement('div');
  wrap.className = 'pw-field';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'pw-toggle'; btn.textContent = 'Show';
  btn.setAttribute('aria-label', 'Show password');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  wrap.appendChild(btn);

  if (input.hasAttribute('data-strength')) {
    const meter = document.createElement('div');
    meter.className = 'pw-meter';
    meter.innerHTML = '<div class="pw-bars"><i></i><i></i><i></i><i></i></div><div class="pw-label"></div><div class="pw-tips"></div>';
    wrap.after(meter);
    const update = () => {
      const r = passwordStrength(input.value);
      meter.dataset.score = input.value ? r.score : '';
      meter.querySelector('.pw-label').textContent = r.label ? `Password strength: ${r.label}` : '';
      meter.querySelector('.pw-tips').textContent = input.value && r.tips.length && r.score < 4 ? `Add ${r.tips.slice(0, 3).join(', ')}` : '';
    };
    input.addEventListener('input', update);
  }
}

function enhancePasswordFields(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhancePasswordField);
}
document.addEventListener('DOMContentLoaded', () => {
  enhancePasswordFields();
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) enhancePasswordFields(n.matches?.('input[type="password"]') ? n.parentNode : n); });
  }).observe(document.body, { childList: true, subtree: true });
});
