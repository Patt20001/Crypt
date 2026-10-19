const user = requireAuth();
if (user) document.addEventListener('DOMContentLoaded', load);

async function load() {
  try {
    const p = await api('/api/portfolio');
    document.getElementById('total').textContent = '$' + p.total.toLocaleString(undefined, { maximumFractionDigits: 2 });

    document.getElementById('holdings').innerHTML = p.holdings.map(h => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-weight:700;">${h.symbol}</div>
          <div class="tag">${h.pct.toFixed(1)}%</div>
        </div>
        <div class="balance" style="font-size:22px;">$${h.usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div class="tag" style="margin-top:6px;">${h.amount.toFixed(h.symbol === 'USDT' ? 2 : 6)} ${h.symbol} @ $${h.price.toLocaleString()}</div>
      </div>`).join('');

    drawChart(p.history);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function drawChart(history) {
  const svg = document.getElementById('chart');
  if (!svg || !history.length) return;

  const W = 800, H = 220, P = 30;
  const values = history.map(h => h.usd);
  const min = Math.min(...values) * 0.98;
  const max = Math.max(...values) * 1.02;
  const step = (W - P * 2) / Math.max(1, history.length - 1);

  const points = history.map((h, i) => {
    const x = P + i * step;
    const y = H - P - ((h.usd - min) / (max - min)) * (H - P * 2);
    return [x, y];
  });

  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
  const areaD = `${pathD} L${points[points.length-1][0]},${H-P} L${points[0][0]},${H-P} Z`;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#4ade80" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#grad)"/>
    <path d="${pathD}" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map(([x,y], i) => i === points.length - 1
      ? `<circle cx="${x}" cy="${y}" r="5" fill="#4ade80"/><circle cx="${x}" cy="${y}" r="10" fill="#4ade80" opacity=".25"/>`
      : '').join('')}
    <text x="${W-P}" y="${H-8}" text-anchor="end" fill="#64748b" font-size="11">${history[history.length-1].date}</text>
    <text x="${P}" y="${H-8}" fill="#64748b" font-size="11">${history[0].date}</text>`;
}