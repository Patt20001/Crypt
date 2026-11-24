const user = requireAuth();

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  try {
    // ---- Balances ----
    const bal = await api('/api/wallet/balance');
animateNumber(document.getElementById('usdt'), bal.balances.USDT || 0, 2);
animateNumber(document.getElementById('eth'),  bal.balances.ETH  || 0, 4);
animateNumber(document.getElementById('bnb'),  bal.balances.BNB  || 0, 4);

    // ---- Account status ----
    const me = await api('/api/auth/me').then(r => r.user);
    const kyc = document.getElementById('kyc-status');
    kyc.textContent = me.kycStatus[0].toUpperCase() + me.kycStatus.slice(1);
    kyc.style.color = me.kycStatus === 'verified' ? 'var(--accent)'
                    : me.kycStatus === 'pending'  ? '#fbbf24'
                    : '#fca5a5';

    document.getElementById('twofa-status').textContent = me.twoFA ? 'Enabled' : 'Disabled';
    document.getElementById('twofa-status').style.color = me.twoFA ? 'var(--accent)' : 'var(--text-mute)';

    document.getElementById('member-since').textContent =
      new Date(me.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    // ---- Transactions ----
    const txs = await api('/api/wallet/transactions');
    renderTxs(txs);
    renderOnboarding(me, txs);

    // ---- Broadcast banner ----
    try {
      const s = await api('/api/settings');
      if (s.banner?.active && s.banner.message) {
        const slot = document.getElementById('banner-slot');
        if (slot) slot.innerHTML = `<div class="broadcast">${s.banner.message}</div>`;
      }
    } catch {}
  } catch (e) {
    const t = document.getElementById('txs');
    if (t) t.innerHTML = emptyState('⚠️', 'Could not load your activity', e.message || 'Please try again.');
    toast(e.message, 'error');
  }
}

/* ---------------- GET STARTED PROMPTS ---------------- */
function renderOnboarding(me, txs) {
  const slot = document.getElementById('onboarding');
  if (!slot) return;
  const key = `onboardingHidden:${me._id || me.id || user.id}`;
  const kycDone = me.kycStatus === 'verified' || me.kycStatus === 'pending';
  const depositDone = txs.some(t => t.type === 'deposit' && t.status === 'completed');
  const depositPending = !depositDone && txs.some(t => t.type === 'deposit' && t.status === 'pending');
  const steps = [
    { done: kycDone, icon: '🛡️', title: 'Verify your identity', sub: me.kycStatus === 'pending' ? 'Your documents are under review.' : me.kycStatus === 'verified' ? 'Verified. No daily withdrawal limit.' : 'Raise your daily withdrawal limit from 100 USDT.', href: '/profile.html', cta: 'Verify now' },
    { done: !!me.twoFA, icon: '🔐', title: 'Enable two-factor authentication', sub: me.twoFA ? 'Your account is protected.' : 'Protect sign-in and withdrawals with an authenticator app.', href: '/profile.html', cta: 'Enable 2FA' },
    { done: depositDone, icon: '💰', title: 'Make your first deposit', sub: depositDone ? 'Funds received.' : depositPending ? 'Your deposit is awaiting network confirmations.' : 'Add USDT to start trading, swapping and staking.', href: '/wallet.html', cta: depositPending ? 'View status' : 'Deposit' }
  ];
  const done = steps.filter(s => s.done).length;
  if (done === steps.length || localStorage.getItem(key)) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="card onboard">
      <div class="onboard-head">
        <div><h3 style="margin:0;">Get started</h3><div class="tag">${done} of ${steps.length} steps complete</div></div>
        <button class="secondary sm" onclick="hideOnboarding('${key}')" aria-label="Hide">Hide</button>
      </div>
      <div class="onboard-progress"><div style="width:${Math.round(done / steps.length * 100)}%"></div></div>
      ${steps.map(s => `
        <div class="onboard-step ${s.done ? 'done' : ''}">
          <div class="ob-icon">${s.done ? '✓' : s.icon}</div>
          <div class="ob-text"><b>${s.title}</b><span class="tag">${s.sub}</span></div>
          ${s.done ? '' : `<a class="btn sm" href="${s.href}">${s.cta}</a>`}
        </div>`).join('')}
    </div>`;
}
window.hideOnboarding = key => { localStorage.setItem(key, '1'); document.getElementById('onboarding').innerHTML = ''; };

function renderTxs(txs) {
  const el = document.getElementById('txs');
  if (!txs.length) {
    el.innerHTML = emptyState('🧾', 'No activity yet', 'Your deposits, withdrawals and trades will appear here.', { label: 'Make a deposit', href: '/wallet.html' });
    return;
  }
  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead>
        <tr><th>Date</th><th>Type</th><th>Currency</th><th>Amount</th><th>Status</th></tr>
      </thead>
      <tbody>
       ${txs.slice(0, 10).map(t => {
  const isPendingDeposit = t.type === 'deposit' && t.status === 'pending';
  const amountCell = isPendingDeposit
    ? '<span class="tag">Awaiting confirmation</span>'
    : `<span style="font-weight:600; color: ${t.amount < 0 ? '#fca5a5' : 'var(--accent)'};">
        ${t.amount > 0 ? '+' : ''}${t.amount}
      </span>`;

  return `
    <tr>
      <td>${new Date(t.createdAt).toLocaleString()}</td>
      <td style="text-transform: capitalize;">${t.type}</td>
      <td>${t.currency}</td>
      <td>${amountCell}</td>
      <td><span class="badge ${t.status}">${t.status}</span></td>
    </tr>`;
}).join('')}
      </tbody>
    </table></div>`;
}