const user = requireAuth();
if (user) document.addEventListener('DOMContentLoaded', load);

async function load() {
  try {
    const p = await api('/api/portfolio');
    document.getElementById('total').textContent = '$' + p.total.toLocaleString(undefined, {
      maximumFractionDigits: 2
    });

    // PnL cards
    const pnl = p.pnl || {};
    document.getElementById('pnl-realized').textContent = formatMoney(pnl.realized);
    document.getElementById('pnl-unrealized').textContent = formatMoney(pnl.unrealized);
    document.getElementById('pnl-total').textContent = formatMoney(pnl.total);
    document.getElementById('pnl-total').style.color = pnl.total >= 0 ? 'var(--accent)' : '#fca5a5';

    // Holdings
    document.getElementById('holdings').innerHTML = p.holdings.map(h => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-weight:700;">${h.symbol}</div>
          <div class="tag">${h.pct.toFixed(1)}%</div>
        </div>
        <div class="balance" style="font-size:22px;">$${h.usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div class="tag" style="margin-top:6px;">${h.amount.toFixed(h.symbol === 'USDT' ? 2 : 6)} ${h.symbol} @ $${h.price.toLocaleString()}</div>
      </div>`).join('') || '<div class="empty">No holdings</div>';

    // Positions with PnL
    if (pnl.positions && pnl.positions.length) {
      document.getElementById('positions').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Pair</th><th>Amount</th><th>Avg Cost</th><th>Current</th>
            <th>Unrealized</th><th>Realized</th>
          </tr></thead>
          <tbody>${pnl.positions.map(pos => `
            <tr>
              <td style="font-weight:600;">${pos.pair}</td>
              <td>${pos.amount.toFixed(6)}</td>
              <td>$${pos.avgCost.toFixed(2)}</td>
              <td>$${pos.currentPrice.toFixed(2)}</td>
              <td style="color: ${pos.unrealized >= 0 ? 'var(--accent)' : '#fca5a5'}; font-weight:600;">
                ${formatMoney(pos.unrealized)} (${pos.unrealizedPct.toFixed(2)}%)
              </td>
              <td style="color: ${pos.realized >= 0 ? 'var(--accent)' : '#fca5a5'};">
                ${formatMoney(pos.realized)}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
    } else {
      document.getElementById('positions').innerHTML = '<div class="empty">No open positions yet</div>';
    }

    drawChart(p.history);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function formatMoney(v) {
  if (!v) return '$0.00';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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
      : '').join('')}`;
}