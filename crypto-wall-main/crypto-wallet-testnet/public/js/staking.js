const user = requireAuth();
let plans = [];
let selected = 'flexible';
let availableUSDT = 0;
let stakeList = [];

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
  availableUSDT = Number(b.balances.USDT || 0);
  document.getElementById('avail').textContent = availableUSDT.toFixed(2);
}

async function loadStakes() {
  const el = document.getElementById('stakes');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const stakes = await api('/api/staking/my-stakes');
    if (!stakes.length) {
      stakeList = [];
      el.innerHTML = emptyState('🌱', 'No staking positions yet', 'Choose a plan above and stake USDT to start earning yield.');
      return;
    }
    stakeList = stakes;
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
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load your positions', e.message || 'Please try again.'); }
}

window.createStake = async () => {
  const amount = Number(document.getElementById('stake-amount').value);
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  if (amount > availableUSDT) return toast('Insufficient USDT balance', 'warn');
  const plan = plans.find(p => p.id === selected);
  const ok = await confirmAction({
    title: 'Confirm stake',
    message: plan?.days ? `Your USDT will be locked for ${plan.days} days.` : 'Flexible plan: no lock, withdraw anytime.',
    details: [['Plan', plan?.label || selected], ['Amount', `${amount.toFixed(2)} USDT`], ['APY', `${plan?.apy}%`], ['Lock period', plan?.days ? `${plan.days} days` : 'None']],
    confirmText: 'Stake now'
  });
  if (!ok) return;
  const btn = document.querySelector('button[onclick="createStake()"]');
  await withBusy(btn, 'Staking…', async () => {
    try {
      await api('/api/staking/stake', { method: 'POST', body: JSON.stringify({ plan: selected, amount }) });
      toast('Stake created successfully', 'success');
      document.getElementById('stake-amount').value = '';
      await Promise.all([loadBalance(), loadStakes()]);
    } catch (e) { toast(e.message, 'error'); }
  });
};

window.unstake = async (id) => {
  const st = stakeList.find(x => x._id === id);
  const early = st && st.plan !== 'flexible' && new Date(st.maturesAt) > new Date();
  const penalty = early ? st.amount * 0.05 : 0;
  const ok = await confirmAction({
    title: 'Unstake position',
    message: early ? 'This plan has not matured yet. Unstaking early incurs a 5% penalty on the staked amount.' : 'Your staked amount and accrued yield will be returned to your wallet.',
    details: st ? [['Staked', `${st.amount.toFixed(2)} USDT`], ['Accrued yield', `${st.accrued.toFixed(4)} USDT`], ...(early ? [['Early unstake penalty', `${penalty.toFixed(2)} USDT`]] : [])] : [],
    confirmText: 'Unstake', danger: early
  });
  if (!ok) return;
  try {
    const r = await api(`/api/staking/unstake/${id}`, { method: 'POST' });
    toast(`Unstaked. Received ${r.payout.toFixed(4)} USDT`, 'success');
    await Promise.all([loadBalance(), loadStakes()]);
  } catch (e) { toast(e.message, 'error'); }
};
