const user = requireAuth();
if (user) {
  document.addEventListener('DOMContentLoaded', async () => {
    const nets = await api('/api/networks');
    document.getElementById('nets').innerHTML = nets.map(n => `
      <div class="card">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom: 12px;">
          <span class="net-dot" style="width:12px; height:12px; background:${n.color}; color:${n.color};"></span>
          <div style="font-weight: 700; font-size: 15px;">${n.name}</div>
        </div>
        <div class="row"><div class="row-label">Symbol</div><div class="row-sub">${n.symbol}</div></div>
        <div class="row"><div class="row-label">Min deposit</div><div class="row-sub">${n.minDeposit} USDT</div></div>
        <div class="row"><div class="row-label">Min withdrawal</div><div class="row-sub">${n.minWithdraw} USDT</div></div>
        <div class="row"><div class="row-label">Network fee</div><div class="row-sub">${n.fee} USDT</div></div>
        <div class="row"><div class="row-label">Confirmations</div><div class="row-sub">${n.confirmations}</div></div>
      </div>`).join('');
  });
}