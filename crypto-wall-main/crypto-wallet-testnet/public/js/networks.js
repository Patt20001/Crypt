const user = requireAuth();
if (user) {
  document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('nets');
    box.innerHTML = skeletonCards(3);
    let nets;
    try { nets = await api('/api/networks'); }
    catch (e) { box.innerHTML = emptyState('⚠️', 'Could not load networks', e.message || 'Please try again.'); return; }
    if (!nets.length) { box.innerHTML = emptyState('🌐', 'No networks available', 'Please check back soon.'); return; }

    document.getElementById('nets').innerHTML = nets.map(n => `
      <div class="card">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom: 14px;">
          <span class="net-dot" style="width:12px; height:12px; background:${n.color}; color:${n.color};"></span>
          <div style="font-weight: 700; font-size: 15px;">${n.name}</div>
        </div>

        <div class="row"><div class="row-label">Confirmations</div><div class="row-sub">${n.confirmations}</div></div>

        ${n.currencies.map(c => `
          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--accent);">${c.symbol}</div>
            <div class="row"><div class="row-label">Min deposit</div><div class="row-sub">${c.minDeposit} ${c.symbol}</div></div>
            <div class="row"><div class="row-label">Min withdrawal</div><div class="row-sub">${c.minWithdraw} ${c.symbol}</div></div>
            <div class="row"><div class="row-label">Network fee</div><div class="row-sub">${c.fee} ${c.symbol}</div></div>
          </div>
        `).join('')}
      </div>
    `).join('');
  });
}