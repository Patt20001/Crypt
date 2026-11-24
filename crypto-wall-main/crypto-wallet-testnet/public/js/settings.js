const user = requireAuth();
if (user) document.addEventListener('DOMContentLoaded', init);

let wl = { enabled: false, cooldownHours: 24, addresses: [], twoFA: false };

async function init() {
  await Promise.all([loadOverview(), loadWhitelist(), loadActivity()]);
  const sw = document.getElementById('wl-switch');
  sw.addEventListener('click', toggleWhitelistMode);
  sw.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWhitelistMode(); } });
}

/* ---------------- OVERVIEW ---------------- */
async function loadOverview() {
  const el = document.getElementById('sec-overview');
  try {
    const me = await api('/api/auth/me').then(r => r.user);
    wl.twoFA = !!me.twoFA;
    const item = (ok, title, sub, href, cta) => `
      <div class="set-row"><div><b>${ok ? '✅' : '⚠️'} ${title}</b><div class="tag">${sub}</div></div>
      ${ok ? '<span class="badge completed">On</span>' : `<a class="btn sm" href="${href}">${cta}</a>`}</div>`;
    const kyc = me.kycStatus;
    el.innerHTML =
      item(me.twoFA, 'Two-factor authentication', me.twoFA ? 'Your account is protected with an authenticator app.' : 'Add a second step at sign-in and for withdrawals.', '/profile.html', 'Enable 2FA') +
      item(kyc === 'verified', 'Identity verification', kyc === 'verified' ? 'Verified. No daily withdrawal limit.' : kyc === 'pending' ? 'Your documents are under review.' : 'Verify to raise your daily withdrawal limit.', '/profile.html', kyc === 'pending' ? 'View status' : 'Verify identity') +
      item(wl.enabled, 'Withdrawal whitelist', wl.enabled ? 'Withdrawals are limited to saved addresses.' : 'Restrict withdrawals to addresses you trust (below).', '#wl-list', 'Set up');
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load security overview', e.message || 'Please try again.'); }
}

/* ---------------- WHITELIST ---------------- */
function renderWhitelistState() {
  document.getElementById('wl-state').textContent = wl.enabled ? 'On' : 'Off';
  const sw = document.getElementById('wl-switch');
  sw.classList.toggle('on', wl.enabled); sw.setAttribute('aria-checked', String(wl.enabled));
  document.getElementById('wl-hours').textContent = wl.cooldownHours;
}

async function loadWhitelist() {
  const el = document.getElementById('wl-list');
  try {
    const d = await api('/api/wallet/whitelist');
    wl = { ...wl, enabled: d.enabled, cooldownHours: d.cooldownHours, addresses: d.addresses };
    renderWhitelistState();
    if (!d.addresses.length) { el.innerHTML = emptyState('📬', 'No saved addresses', 'Add an address below. It becomes usable after the security waiting period.'); return; }
    el.innerHTML = d.addresses.map(a => {
      const hrs = Math.max(1, Math.ceil((new Date(a.activeAt) - Date.now()) / 3600000));
      return `<div class="addr-item">
        <div style="min-width:0;flex:1;">
          <div><b>${escHtml(a.label || 'Unnamed address')}</b> <span class="tag">${escHtml(a.network)}</span>
            ${a.active ? '<span class="badge completed">Active</span>' : `<span class="badge pending">Available in ~${hrs}h</span>`}</div>
          <div class="mono">${escHtml(a.address)}</div>
        </div>
        <button class="secondary sm" onclick="removeWhitelist('${a._id}')">Remove</button>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load your addresses', e.message || 'Please try again.'); }
}

window.addWhitelist = async () => {
  const network = document.getElementById('wl-network').value;
  const label = document.getElementById('wl-label').value.trim();
  const address = document.getElementById('wl-address').value.trim();
  if (!address) return toast('Enter a wallet address', 'warn');
  let code;
  if (wl.twoFA) {
    code = await confirmAction({ title: 'Confirm with 2FA', message: `Enter your authenticator code to add this ${network} address.`, input: { label: '2FA code', placeholder: '6-digit code', maxlength: 12, inputmode: 'numeric' }, confirmText: 'Add address' });
    if (code === null) return;
  } else {
    const ok = await confirmAction({ title: 'Add withdrawal address', message: `This address can be used for withdrawals after a ${wl.cooldownHours}-hour waiting period.`, details: [['Network', network], ['Address', address]], confirmText: 'Add address' });
    if (!ok) return;
  }
  await withBusy(document.getElementById('wl-add'), 'Adding…', async () => {
    try {
      await api('/api/wallet/whitelist', { method: 'POST', body: JSON.stringify({ network, label, address, code }) });
      toast('Address added', 'success');
      document.getElementById('wl-label').value = ''; document.getElementById('wl-address').value = '';
      await Promise.all([loadWhitelist(), loadOverview()]);
    } catch (e) { toast(e.message, 'error'); }
  });
};

window.removeWhitelist = async id => {
  const ok = await confirmAction({ title: 'Remove address', message: 'You will no longer be able to withdraw to this address while the whitelist is on.', confirmText: 'Remove', danger: true });
  if (!ok) return;
  try { await api(`/api/wallet/whitelist/${id}`, { method: 'DELETE' }); toast('Address removed', 'success'); await loadWhitelist(); }
  catch (e) { toast(e.message, 'error'); }
};

async function toggleWhitelistMode() {
  const turningOn = !wl.enabled;
  let body = { enabled: turningOn };
  if (turningOn) {
    const ok = await confirmAction({ title: 'Turn on withdrawal whitelist', message: 'Withdrawals will only be allowed to saved addresses that have finished their waiting period. Make sure you have added the address you need.', confirmText: 'Turn on' });
    if (!ok) return;
  } else {
    const password = await confirmAction({ title: 'Turn off withdrawal whitelist', message: 'Enter your password to allow withdrawals to any address.', input: { label: 'Password', type: 'password', placeholder: 'Your password' }, confirmText: 'Turn off', danger: true });
    if (password === null) return;
    body.password = password;
    if (wl.twoFA) {
      const code = await confirmAction({ title: 'Confirm with 2FA', input: { label: '2FA code', placeholder: '6-digit code', maxlength: 12, inputmode: 'numeric' }, confirmText: 'Confirm' });
      if (code === null) return;
      body.code = code;
    }
  }
  try {
    await api('/api/wallet/whitelist/mode', { method: 'PUT', body: JSON.stringify(body) });
    toast(turningOn ? 'Withdrawal whitelist is on' : 'Withdrawal whitelist is off', 'success');
    await Promise.all([loadWhitelist(), loadOverview()]);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- SIGN-IN ACTIVITY ---------------- */
function describeDevice(ua = '') {
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  const os = /windows/i.test(ua) ? 'Windows' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Unknown device';
  return `${browser} on ${os}`;
}

async function loadActivity() {
  const el = document.getElementById('activity-list');
  try {
    const list = await api('/api/profile/login-activity');
    if (!list.length) { el.innerHTML = emptyState('🕘', 'No sign-in activity yet', 'Recent sign-ins will be listed here.'); return; }
    el.innerHTML = list.map((h, i) => `<div class="activity-item">
      <div><b>${escHtml(describeDevice(h.userAgent))}</b>${i === 0 ? ' <span class="badge completed">Latest</span>' : ''}<div class="tag">IP ${escHtml(h.ip || 'unknown')}</div></div>
      <div class="tag" style="text-align:right;">${new Date(h.at).toLocaleString()}</div></div>`).join('');
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load sign-in activity', e.message || 'Please try again.'); }
}

window.logoutAll = async () => {
  const ok = await confirmAction({ title: 'Sign out of all devices?', message: 'Every other device will be signed out. You will stay signed in here.', confirmText: 'Sign out all devices', danger: true });
  if (!ok) return;
  await withBusy(document.getElementById('logout-all-btn'), 'Signing out…', async () => {
    try {
      const r = await api('/api/profile/logout-all', { method: 'POST' });
      if (r?.token) localStorage.setItem('token', r.token);
      toast('Signed out of all other devices', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
};
