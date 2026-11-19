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

let forgotState = { email: '', questions: [], token: '' };

window.openForgotPassword = () => {
  forgotState = { email: '', questions: [], token: '' };
  document.getElementById('forgot-title').textContent = 'Reset Password';
  document.getElementById('forgot-body').innerHTML = `
    <p class="tag" style="margin-bottom: 14px;">Enter your email to begin password recovery.</p>
    <label>Email</label>
    <input id="fp-email" type="email" placeholder="you@example.com" />
    <div id="fp-msg" style="min-height: 18px; margin-bottom: 10px;"></div>
    <button style="width:100%" onclick="forgotStart()">Continue</button>
  `;
  openModal('forgot-modal');
};

window.forgotStart = async () => {
  const email = document.getElementById('fp-email').value.trim();
  const msg = document.getElementById('fp-msg');
  if (!email) { msg.className = 'error'; msg.textContent = 'Email required'; return; }

  msg.className = ''; msg.textContent = 'Looking up account…';

  try {
    const r = await fetch('/api/auth/forgot-password/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    }).then(x => x.json());

    if (!r.found) {
      msg.className = 'error';
      msg.textContent = 'No account found with that email';
      return;
    }

    if (!r.hasQuestions) {
      msg.className = 'error';
      msg.textContent = r.message || 'No recovery questions set. Contact support.';
      return;
    }

    forgotState.email = email;
    forgotState.questions = r.questions;

    document.getElementById('forgot-title').textContent = 'Answer Security Questions';
    document.getElementById('forgot-body').innerHTML = `
      <p class="tag" style="margin-bottom: 14px;">
        Answer all 3 questions to verify your identity. Answers are case-insensitive.
      </p>
      ${r.questions.map((q, i) => `
        <div style="margin-bottom: 14px;">
          <label>${q}</label>
          <input id="fp-a-${i}" placeholder="Your answer" />
        </div>
      `).join('')}
      <div id="fp-msg2" style="min-height: 18px; margin-bottom: 10px;"></div>
      <button style="width:100%" onclick="forgotVerify()">Verify Answers</button>
    `;
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};

window.forgotVerify = async () => {
  const answers = [0, 1, 2].map(i => document.getElementById(`fp-a-${i}`).value);
  const msg = document.getElementById('fp-msg2');

  if (answers.some(a => !a)) {
    msg.className = 'error';
    msg.textContent = 'Answer all questions';
    return;
  }

  msg.className = ''; msg.textContent = 'Verifying…';

  try {
    const r = await fetch('/api/auth/forgot-password/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotState.email, answers })
    }).then(x => x.json());

    if (!r.ok) {
      msg.className = 'error';
      msg.textContent = r.error || 'Verification failed';
      return;
    }

    forgotState.token = r.token;

    document.getElementById('forgot-title').textContent = 'Set New Password';
    document.getElementById('forgot-body').innerHTML = `
      <p class="tag" style="margin-bottom: 14px;">Choose a new password for your account.</p>
      <label>New password</label>
      <input id="fp-newpwd" type="password" placeholder="Min 6 characters" />
      <label>Confirm new password</label>
      <input id="fp-confirm" type="password" placeholder="Type again" />
      <div id="fp-msg3" style="min-height: 18px; margin-bottom: 10px;"></div>
      <button style="width:100%" onclick="forgotReset()">Reset Password</button>
    `;
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};

window.forgotReset = async () => {
  const pwd = document.getElementById('fp-newpwd').value;
  const confirm = document.getElementById('fp-confirm').value;
  const msg = document.getElementById('fp-msg3');

  if (!pwd || pwd.length < 6) { msg.className = 'error'; msg.textContent = 'Password min 6 chars'; return; }
  if (pwd !== confirm) { msg.className = 'error'; msg.textContent = 'Passwords do not match'; return; }

  msg.className = ''; msg.textContent = 'Resetting…';

  try {
    const r = await fetch('/api/auth/forgot-password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgotState.token, newPassword: pwd })
    }).then(x => x.json());

    if (!r.ok) {
      msg.className = 'error';
      msg.textContent = r.error || 'Reset failed';
      return;
    }

    closeModal('forgot-modal');
    if (typeof toast === 'function') toast('Password reset! You can now log in.', 'success');
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};