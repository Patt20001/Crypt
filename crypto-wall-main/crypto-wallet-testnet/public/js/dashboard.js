const user = requireAuth();

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  try {
    // ---- Balances ----
    const bal = await api('/api/wallet/balance');
    animateNumber(document.getElementById('usdt'), bal.balances.USDT, 2);
    animateNumber(document.getElementById('btc'),  bal.balances.BTC,  4);
    animateNumber(document.getElementById('eth'),  bal.balances.ETH,  4);
    document.getElementById('addr').textContent = bal.walletAddress;

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

    // ---- Broadcast banner ----
    try {
      const s = await api('/api/settings');
      if (s.banner?.active && s.banner.message) {
        const slot = document.getElementById('banner-slot');
        if (slot) slot.innerHTML = `<div class="broadcast">${s.banner.message}</div>`;
      }
    } catch {}
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderTxs(txs) {
  const el = document.getElementById('txs');
  if (!txs.length) {
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

window.copyAddress = () => {
  const addr = document.getElementById('addr').textContent.trim();
  if (!addr || addr === 'Loading…') return;
  navigator.clipboard.writeText(addr);
  toast('Wallet address copied', 'success', 1600);
};