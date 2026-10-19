const user = requireAuth();
let allTraders = [];
let userBalance = 0;

if (user) document.addEventListener('DOMContentLoaded', init);

async function init() {
  await Promise.all([loadBalance(), loadTraders(), loadMyCopies()]);
}

async function loadBalance() {
  try {
    const b = await api('/api/wallet/balance');
    userBalance = b.balances?.USDT || 0;
  } catch {}
}

async function loadTraders() {
  const el = document.getElementById('traders');
  el.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(4);
  try {
    allTraders = await api('/api/copy');
    if (!allTraders.length) {
  el.innerHTML = '<div class="empty">No traders available yet. Check back soon.</div>';
  return;
}
    el.innerHTML = allTraders.map(t => `
      <div class="card" style="${t.featured ? 'border-color: rgba(74,222,128,.4);' : ''}">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
          <div class="avatar avatar-lg">${t.displayName[0]}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; font-size:16px;">${t.displayName}</div>
            <div class="tag">${t.tier} · ${t.totalTrades} trades</div>
          </div>
          ${t.featured ? '<span class="badge completed">Featured</span>' : ''}
        </div>
        <p class="tag" style="margin-bottom:14px; line-height:1.5;">${t.bio}</p>
        <div class="grid grid-3" style="gap:10px; margin-bottom:16px;">
          <div>
            <div class="tag">30d ROI</div>
            <div style="font-weight:700; font-size:16px; color:var(--accent);">+${t.roi30d}%</div>
          </div>
          <div>
            <div class="tag">Win rate</div>
            <div style="font-weight:700; font-size:16px;">${t.winRate}%</div>
          </div>
          <div>
            <div class="tag">Followers</div>
            <div style="font-weight:700; font-size:16px;">${t.followers}</div>
          </div>
        </div>
        <button style="width:100%" onclick="openFollow('${t._id}')">Copy this trader</button>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function loadMyCopies() {
  const el = document.getElementById('my-copies');
  try {
    const list = await api('/api/copy/my');
    if (!list.length) {
      el.innerHTML = '<div class="empty">You are not copying anyone yet</div>';
      return;
    }
    el.innerHTML = list.map(r => `
      <div class="task" style="flex-direction: column; align-items: stretch; gap: 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600;">${r.trader?.displayName || 'Unknown'}</div>
            <div class="tag">Allocated: ${r.allocation.toFixed(2)} USDT</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700; color: ${r.pnl >= 0 ? 'var(--accent)' : '#fca5a5'};">
              ${r.pnl >= 0 ? '+' : ''}${(r.pnl || 0).toFixed(2)} USDT
            </div>
            <div class="tag">PnL</div>
          </div>
        </div>
        <button class="danger sm" onclick="unfollow('${r._id}')" style="align-self:flex-start;">
          Stop copying
        </button>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

window.openFollow = (traderId) => {
  const t = allTraders.find(x => x._id === traderId);
  if (!t) return;
  document.getElementById('follow-title').textContent = `Copy ${t.displayName}`;
  document.getElementById('follow-body').innerHTML = `
    <p class="tag" style="margin-bottom:14px;">
      Allocate USDT to mirror ${t.displayName}'s trades. You can stop anytime.
    </p>
    <div style="padding:12px; background:rgba(148,163,184,.06); border-radius:10px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between;">
        <span class="tag">Your balance</span>
        <b>${userBalance.toFixed(2)} USDT</b>
      </div>
    </div>
    <label>Allocation (USDT)</label>
    <input id="copy-amount" type="number" min="10" placeholder="100" />
    <p class="tag" style="margin-top:-6px; margin-bottom:14px;">Minimum 10 USDT</p>
    <button style="width:100%" onclick="confirmFollow('${t._id}')">Start copying</button>
  `;
  openModal('follow-modal');
};

window.confirmFollow = async (traderId) => {
  const amt = Number(document.getElementById('copy-amount').value);
  if (!amt || amt < 10) return toast('Minimum allocation is 10 USDT', 'warn');
  try {
    await api(`/api/copy/follow/${traderId}`, {
      method: 'POST',
      body: JSON.stringify({ allocation: amt })
    });
    closeModal('follow-modal');
    toast('You are now copying this trader', 'success');
    await Promise.all([loadBalance(), loadMyCopies(), loadTraders()]);
  } catch (e) { toast(e.message, 'error'); }
};

window.unfollow = async (relId) => {
  if (!confirm('Stop copying this trader? Your allocation + PnL returns to your wallet.')) return;
  try {
    await api(`/api/copy/unfollow/${relId}`, { method: 'POST' });
    toast('Stopped copying', 'success');
    await Promise.all([loadBalance(), loadMyCopies()]);
  } catch (e) { toast(e.message, 'error'); }
};
