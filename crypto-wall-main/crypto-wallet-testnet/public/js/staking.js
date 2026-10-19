const user = requireAuth();
let plans = [];
let selected = 'flexible';

if (user) {
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    await Promise.all([loadPlans(), loadBalance(), loadStakes()]);
  }
}

async function loadPlans() {
  plans = await api('/api/staking/plans');
  const el = document.getElementById('plans');
  el.innerHTML = plans.map(p => `
    <div class="stake-plan ${p.id === selected ? 'selected' : ''}" data-plan="${p.id}">
      <div class="plan-name">${p.label}</div>
      <div class="apy">${p.apy}%</div>
      <div class="plan-desc">${p.days === 0 ? 'No lock · withdraw anytime' : `Lock ${p.days} days · ${p.apy}% APY`}</div>
    </div>`).join('');
  el.querySelectorAll('.stake-plan').forEach(el => {
    el.addEventListener('click', () => {
      selected = el.dataset.plan;
      el.parentElement.querySelectorAll('.stake-plan').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

async function loadBalance() {
  const b = await api('/api/wallet/balance');
  document.getElementById('avail').textContent = b.balances.USDT.toFixed(2);
}

async function loadStakes() {
  const el = document.getElementById('stakes');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const stakes = await api('/api/staking/my-stakes');
    if (!stakes.length) {
      el.innerHTML = '<div class="empty">No active positions. Start staking to earn yield.</div>';
      return;
    }
    el.innerHTML = stakes.map(s => {
      const total = new Date(s.maturesAt) - new Date(s.startedAt);
      const done = Date.now() - new Date(s.startedAt);
      const pct = s.status === 'closed' ? 100 : Math.min(100, (done / total) * 100);
      const matures = new Date(s.maturesAt).toLocaleDateString();
      return `
        <div class="task" style="flex-direction: column; align-items: stretch; gap: 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-weight: 600;">${s.amount.toFixed(2)} USDT · ${s.plan.toUpperCase()}</div>
              <div class="tag">${s.apy}% APY · matures ${matures}</div>
            </div>
            <div style="text-align:right;">
              <div class="reward" style="font-size: 16px;">+${s.accrued.toFixed(4)} USDT</div>
              <div class="tag">accrued yield</div>
            </div>
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          ${s.status === 'active' ? `<button class="secondary sm" onclick="unstake('${s._id}')" style="align-self:flex-start;">Unstake</button>` : '<span class="badge completed">closed</span>'}
        </div>`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

window.createStake = async () => {
  const amount = Number(document.getElementById('stake-amount').value);
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  try {
    await api('/api/staking/stake', { method: 'POST', body: JSON.stringify({ plan: selected, amount }) });
    toast('Stake created successfully', 'success');
    document.getElementById('stake-amount').value = '';
    await Promise.all([loadBalance(), loadStakes()]);
  } catch (e) { toast(e.message, 'error'); }
};

window.unstake = async (id) => {
  if (!confirm('Unstake this position? Early unstake from locked plans incurs a 5% penalty.')) return;
  try {
    const r = await api(`/api/staking/unstake/${id}`, { method: 'POST' });
    toast(`Unstaked. Received ${r.payout.toFixed(4)} USDT`, 'success');
    await Promise.all([loadBalance(), loadStakes()]);
  } catch (e) { toast(e.message, 'error'); }
};