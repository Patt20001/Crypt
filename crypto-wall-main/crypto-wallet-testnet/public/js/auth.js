/* ============================================================
   NovaWallet — Auth helpers (register, login, logout, api)
   ============================================================ */

const API = '';

/* ---------------- MESSAGE HELPER ---------------- */
function showMsg(text, ok = false) {
  const el = document.getElementById('msg');
  if (el) {
    el.className = ok ? 'success' : 'error';
    el.textContent = text;
  }
  if (typeof toast === 'function') toast(text, ok ? 'success' : 'error');
}

/* ---------------- REGISTER ---------------- */
async function register() {
  const username = document.getElementById('username').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const referralCode = document.getElementById('referral')?.value.trim();
  const acceptTerms = document.getElementById('terms')?.checked;

  if (!acceptTerms) return showMsg('You must accept the Terms & Risk Disclosure');

  try {
    const r = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, referralCode, acceptTerms })
    });
    const d = await r.json();
    if (!r.ok) return showMsg(d.error || 'Registration failed');

    localStorage.setItem('token', d.token);
    localStorage.setItem('user', JSON.stringify(d.user));
    if (typeof toast === 'function') toast('Account created!', 'success');
    setTimeout(() => {
      window.location.replace(d.user.role === 'admin' ? '/admin.html' : '/dashboard.html');
    }, 500);
  } catch (e) { showMsg(e.message); }
}

/* ---------------- LOGIN ---------------- */
async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const code = document.getElementById('code')?.value?.trim();

  const wrap = document.getElementById('twofa-wrap');

  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, code })
    });
    const d = await r.json();

    if (d.requires2FA) {
      if (wrap) wrap.style.display = 'block';
      if (!code) {
        showMsg('Enter the code from your authenticator app');
        document.getElementById('code')?.focus();
        return;
      }
      return showMsg(d.error || 'Invalid 2FA code');
    }

    if (!r.ok) return showMsg(d.error || 'Login failed');

    if (wrap) wrap.style.display = 'none';
    localStorage.setItem('token', d.token);
    localStorage.setItem('user', JSON.stringify(d.user));
    if (typeof toast === 'function') toast('Welcome back!', 'success');
    setTimeout(() => {
      window.location.replace(d.user.role === 'admin' ? '/admin.html' : '/dashboard.html');
    }, 400);
  } catch (e) { showMsg(e.message); }
}

/* ---------------- LOGOUT ---------------- */
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.clear();
  window.location.replace('/login.html');
}

/* ---------------- HELPERS ---------------- */
function token() { return localStorage.getItem('token'); }

function requireAuth(adminOnly = false) {
  const t = token();
  const u = JSON.parse(localStorage.getItem('user') || 'null');
  if (!t || !u) { window.location.replace('/login.html'); return null; }
  if (adminOnly && u.role !== 'admin') { window.location.replace('/dashboard.html'); return null; }
  return u;
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  headers['Content-Type'] = 'application/json';
  if (token()) headers['Authorization'] = `Bearer ${token()}`;
  const r = await fetch(path, { ...options, headers });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Session expired'); }
  if (r.status === 503 && d.error === 'maintenance') {
    throw new Error(d.message || 'Maintenance mode');
  }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

/* ---------------- GLOBAL LOGOUT CLICK ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="logout"]');
  if (el) { e.preventDefault(); logout(); }
});