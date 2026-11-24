const user = requireAuth();
let currentPair = 'BTC/USDT';
let currentSide = 'buy';
let bookInterval = null;
let tradesInterval = null;
let positionsInterval = null;
let balances = { USDT: 0, BTC: 0, ETH: 0 };
let markets = [];
let currentMarketPrice = 0;
let chartInterval = '1m';

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  await loadMarkets();
  await selectPair(currentPair);
  await loadBalances();
  await loadMyOrders();
  await loadMyPositions();
  await loadTradingHistory();

  bookInterval = setInterval(refreshBook, 2000);
  tradesInterval = setInterval(refreshTrades, 5000);
  positionsInterval = setInterval(() => { loadMyPositions(); loadTradingHistory(); }, 15000);   // 👈 auto-refresh positions every 15s

  if (window.setTradeChartInterval) await window.setTradeChartInterval(chartInterval);
  document.querySelectorAll('[data-interval]').forEach(el => el.classList.toggle('active', el.dataset.interval === chartInterval));
}

window.selectPair = async function (pair) {
  currentPair = pair;
  const pairSelect = document.getElementById('market-list');
  if (pairSelect && pairSelect.value !== pair) pairSelect.value = pair;

  await Promise.all([refreshBook(), refreshTrades()]);
  const priceInput = document.getElementById('order-price');
  if (priceInput && document.getElementById('order-type').value === 'limit' && currentMarketPrice > 0) {
    const market = markets.find(m => m.pair === pair);
    priceInput.value = currentMarketPrice.toFixed(market?.decimals ?? 2);
  }
  const slInput = document.getElementById('order-sl');
  const tpInput = document.getElementById('order-tp');
  if (slInput) slInput.value = '';
  if (tpInput) tpInput.value = '';
  updateOrderTotal();
  updateSubmitLabel();
  updateAvailHint();

  // Switch the chart AFTER init completes (guard with await)
  if (window.switchTradePair) {
    await window.switchTradePair(pair);
  }
}; 

async function loadMarkets() {
  try {
    markets = await api('/api/orders/markets');
    renderMarkets(markets);
    const filter = document.getElementById('history-pair-filter');
    if (filter) filter.innerHTML = '<option value="">All markets</option>' + markets.map(m => `<option value="${m.pair}">${m.pair}</option>`).join('');
  } catch (e) { toast(`Could not load markets: ${e.message}`, 'error'); }
}

function renderMarkets(list) {
  const el = document.getElementById('market-list');
  if (!el) return;
  const previous = el.value || currentPair;
  if (!list.length) {
    el.innerHTML = '<option value="">No markets match your search</option>';
    el.disabled = true;
    return;
  }
  el.disabled = false;
  el.innerHTML = list.map(m => `<option value="${m.pair}">${m.pair} · ${m.base}</option>`).join('');
  el.value = list.some(m => m.pair === currentPair) ? currentPair : (list.some(m => m.pair === previous) ? previous : '');
}

window.filterMarkets = function (query) {
  const q = String(query || '').trim().toUpperCase();
  renderMarkets(markets.filter(m => m.pair.includes(q) || m.base.includes(q)));
};

window.setChartInterval = async function (interval) {
  chartInterval = interval;
  document.querySelectorAll('[data-interval]').forEach(el => el.classList.toggle('active', el.dataset.interval === interval));
  if (window.setTradeChartInterval) await window.setTradeChartInterval(interval);
};

window.setAmountPercent = function (percent) {
  const [base, quote] = currentPair.split('/');
  const type = document.getElementById('order-type').value;
  const available = currentSide === 'buy' ? (balances[quote] || 0) : (balances[base] || 0);
  const price = type === 'market' ? currentMarketPrice : (Number(document.getElementById('order-price').value) || currentMarketPrice);
  if (!price || price <= 0) return toast('Price is not available yet', 'warn');
  const amount = currentSide === 'buy' ? (available * percent / 100) / price : available * percent / 100;
  document.getElementById('order-amount').value = amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  updateOrderTotal();
};

window.loadTradingHistory = async function () {
  const el = document.getElementById('trading-history');
  if (!el) return;
  try {
    const pair = document.getElementById('history-pair-filter')?.value || '';
    const rows = await api(`/api/orders/history${pair ? `?pair=${encodeURIComponent(pair)}` : ''}`);
    if (!rows.length) { el.innerHTML = emptyState('🧾', 'No order history yet', 'Completed and cancelled orders will appear here.'); return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Pair</th><th>Side</th><th>Type</th><th>Avg Fill</th><th>Amount</th><th>Status</th><th>Details</th></tr></thead><tbody>${rows.map(o => `
      <tr><td>${new Date(o.updatedAt || o.createdAt).toLocaleString()}</td><td>${o.pair}</td>
      <td style="text-transform:uppercase;color:${o.side === 'buy' ? '#4ade80' : '#fca5a5'}">${o.side}</td>
      <td>${o.type}</td><td>${Number(o.avgFillPrice || o.price).toLocaleString(undefined,{maximumFractionDigits:8})}</td>
      <td>${Number(o.filled || 0).toLocaleString(undefined,{maximumFractionDigits:8})} / ${Number(o.amount).toLocaleString(undefined,{maximumFractionDigits:8})}</td>
      <td>${o.status}</td><td>${o.closeReason || (o.stopLoss || o.takeProfit ? `SL ${o.stopLoss || '—'} / TP ${o.takeProfit || '—'}` : '—')}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load order history', e.message || 'Please try again.'); }
};

async function loadBalances() {
  const b = await api('/api/wallet/balance');
  balances = b.balances || { USDT: 0, BTC: 0, ETH: 0 };
  updateAvailHint();
}

function updateAvailHint() {
  const [base, quote] = currentPair.split('/');
  const el = document.getElementById('order-avail');
  const val = currentSide === 'buy' ? balances[quote] : balances[base];
  el.textContent = `${(val || 0).toFixed(currentSide === 'buy' ? 2 : 6)} ${currentSide === 'buy' ? quote : base}`;
}

window.setSide = function (side) {
  currentSide = side;
  document.getElementById('btn-buy').classList.toggle('secondary', side !== 'buy');
  document.getElementById('btn-sell').classList.toggle('secondary', side !== 'sell');
  updateSubmitLabel();
  updateAvailHint();
};

function updateSubmitLabel() {
  const [base] = currentPair.split('/');
  const btn = document.getElementById('btn-submit');
  btn.textContent = `${currentSide === 'buy' ? 'Buy' : 'Sell'} ${base}`;
  btn.style.background = currentSide === 'buy'
    ? 'linear-gradient(135deg, #4ade80, #22c55e)'
    : 'linear-gradient(135deg, #ef4444, #b91c1c)';
  btn.style.color = currentSide === 'buy' ? '#04240f' : '#fff';
}

window.updateOrderTotal = function () {
  const type = document.getElementById('order-type')?.value || 'limit';
  const price = type === 'market' ? currentMarketPrice : (Number(document.getElementById('order-price').value) || 0);
  const amt = Number(document.getElementById('order-amount').value) || 0;
  const total = price * amt;
  document.getElementById('order-total').textContent = `${total.toFixed(2)} USDT${type === 'market' ? ' (estimate)' : ''}`;
};

async function refreshBook() {
  try {
    const data = await api(`/api/orders/book/${currentPair.replace('/', '-')}`);
    currentMarketPrice = Number(data.mid) || 0;
    document.getElementById('pair-price').textContent = `$${data.mid.toLocaleString()}`;
    updateOrderTotal();

    const fmt = (n, d = 4) => Number(n).toFixed(d);

    document.getElementById('asks').innerHTML = data.asks.map(a => `
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px; font-size: 13px;">
        <span style="color: #fca5a5;">${fmt(a.price, 2)}</span>
        <span style="text-align:right;">${fmt(a.amount)}</span>
        <span style="text-align:right; color: var(--text-mute);">${fmt(a.total, 2)}</span>
      </div>`).join('');

    document.getElementById('bids').innerHTML = data.bids.map(b => `
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px; font-size: 13px;">
        <span style="color: #4ade80;">${fmt(b.price, 2)}</span>
        <span style="text-align:right;">${fmt(b.amount)}</span>
        <span style="text-align:right; color: var(--text-mute);">${fmt(b.total, 2)}</span>
      </div>`).join('');

    const bestBid = data.bids[0]?.price || 0;
    const bestAsk = data.asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    document.getElementById('spread').textContent = `Spread: $${spread.toFixed(2)}`;
  } catch (e) {
    // silent
  }
}

async function refreshTrades() {
  try {
    const trades = await api(`/api/orders/trades/${currentPair.replace('/', '-')}`);
    document.getElementById('trades').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Side</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>${trades.map(t => `
          <tr>
            <td>${new Date(t.time).toLocaleTimeString()}</td>
            <td style="color: ${t.side === 'buy' ? '#4ade80' : '#fca5a5'}; text-transform: uppercase; font-weight:600;">${t.side}</td>
            <td style="font-weight:600;">${t.price.toFixed(2)}</td>
            <td>${t.amount.toFixed(4)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {}
}

async function loadMyOrders() {
  const el = document.getElementById('my-orders');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(2);
  try {
    const orders = await api('/api/orders/my');
    if (!orders.length) {
      el.innerHTML = emptyState('📝', 'No open orders', 'Orders you place will appear here until they are filled or cancelled.');
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Price</th><th>Amount</th><th>Filled</th><th>Status</th><th></th></tr></thead>
        <tbody>${orders.map(o => `
          <tr>
            <td>${new Date(o.createdAt).toLocaleTimeString()}</td>
            <td>${o.pair}</td>
            <td style="color: ${o.side === 'buy' ? '#4ade80' : '#fca5a5'}; text-transform: uppercase; font-weight:600;">${o.side}</td>
            <td>${o.price.toFixed(2)}</td>
            <td>${o.amount.toFixed(4)}</td>
            <td>${o.filled.toFixed(4)}</td>
            <td><span class="badge ${
              o.status === 'filled' ? 'completed'
              : o.status === 'cancelled' ? 'rejected'
              : 'pending'
            }">${o.status}</span></td>
            <td>${['open','partial'].includes(o.status)
              ? `<button class="danger sm" onclick="cancelOrder('${o._id}')">Cancel</button>`
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

window.placeOrder = async () => {
  const price = Number(document.getElementById('order-price').value);
  const amount = Number(document.getElementById('order-amount').value);
  const type = document.getElementById('order-type').value;
  const stopLoss = Number(document.getElementById('order-sl')?.value) || 0;
  const takeProfit = Number(document.getElementById('order-tp')?.value) || 0;

  if (type === 'market') {
    if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  } else {
    if (!price || price <= 0) return toast('Enter a valid price', 'warn');
    if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  }

  const btn = document.getElementById('btn-submit');
  if (btn.disabled) return;
  const base = (currentPair || '').split('/')[0];
  const details = [
    ['Side', currentSide === 'buy' ? 'Buy' : 'Sell'], ['Pair', currentPair],
    ['Type', type === 'market' ? 'Market' : 'Limit'], ['Amount', `${amount} ${base}`],
    ['Price', type === 'market' ? 'Market price' : `${price} USDT`]
  ];
  if (type !== 'market') details.push(['Estimated total', `${(price * amount).toFixed(2)} USDT`]);
  if (stopLoss) details.push(['Stop-loss', `${stopLoss} USDT`]);
  if (takeProfit) details.push(['Take-profit', `${takeProfit} USDT`]);
  const ok = await confirmAction({
    title: `Confirm ${currentSide === 'buy' ? 'buy' : 'sell'} order`,
    message: type === 'market' ? 'Market orders fill at the best available price, which may differ from the price shown.' : '',
    details, confirmText: currentSide === 'buy' ? 'Place buy order' : 'Place sell order', danger: currentSide === 'sell'
  });
  if (!ok) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Placing…';

  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        side: currentSide,
        pair: currentPair,
        type,
        price,
        amount,
        stopLoss,
        takeProfit
      })
    });
    toast('Order submitted', 'success');
    document.getElementById('order-amount').value = '';
    document.getElementById('order-total').textContent = '0.00 USDT';
    const slEl = document.getElementById('order-sl');
    const tpEl = document.getElementById('order-tp');
    if (slEl) slEl.value = '';
    if (tpEl) tpEl.value = '';
        await Promise.all([loadBalances(), loadMyOrders(), loadMyPositions(), loadTradingHistory()]);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
};

window.updateOrderType = () => {
  const type = document.getElementById('order-type').value;
  const priceField = document.getElementById('order-price');
  const priceLabel = document.getElementById('price-label');

  if (type === 'market') {
    priceField.disabled = true;
    priceField.value = '';
    priceField.placeholder = 'Fills at market price';
    if (priceLabel) priceLabel.textContent = 'Price (at market)';
  } else {
    priceField.disabled = false;
    priceField.placeholder = '0.00';
    if (priceLabel) priceLabel.textContent = 'Price (USDT)';
  }
  updateOrderTotal();
};

window.cancelOrder = async (id) => {
  const ok = await confirmAction({
    title: 'Cancel order', message: 'This order will be cancelled and any reserved funds will be released.',
    confirmText: 'Cancel order', cancelText: 'Keep order', danger: true
  });
  if (!ok) return;
  try {
    await api(`/api/orders/${id}/cancel`, { method: 'POST' });
    toast('Order cancelled', 'success');
    await Promise.all([loadBalances(), loadMyOrders(), loadMyPositions(), loadTradingHistory()]);
  } catch (e) { toast(e.message, 'error'); }
};

/* ============================================================
   MY POSITIONS (filled orders, live PnL, close button)
   ============================================================ */
async function loadMyPositions() {
  const el = document.getElementById('my-positions');
  if (!el) return;
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(2);

  try {
    // Get both the raw positions and portfolio PnL data
    const [positions, portfolio] = await Promise.all([
      api('/api/orders/positions'),
      api('/api/portfolio').catch(() => null)
    ]);

    if (!positions.length) {
      el.innerHTML = emptyState('📈', 'No open positions', 'Place a buy order to open your first position.');
      return;
    }

    // Match with PnL data from portfolio
    const pnlMap = {};
    if (portfolio?.pnl?.positions) {
      portfolio.pnl.positions.forEach(p => {
        pnlMap[p.pair] = p;
      });
    }

    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Amount</th>
            <th>Avg Cost</th>
            <th>Current</th>
            <th>Unrealized PnL</th>
            <th>SL / TP</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${positions.map(pos => {
            const pnl = pnlMap[pos.pair] || {};
            const unrealized = pnl.unrealized || 0;
            const unrealizedPct = pnl.unrealizedPct || 0;
            const currentPrice = pnl.currentPrice || pos.avgCost;

            return `
              <tr>
                <td style="font-weight:600;">${pos.pair}</td>
                <td>${pos.amount.toFixed(6)}</td>
                <td>$${pos.avgCost.toFixed(2)}</td>
                <td>$${currentPrice.toFixed(2)}</td>
                <td style="color: ${unrealized >= 0 ? 'var(--accent)' : '#fca5a5'}; font-weight:600;">
                  ${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} (${unrealizedPct.toFixed(2)}%)
                </td>
                <td class="tag">
                  ${pos.stopLoss ? `SL $${pos.stopLoss.toFixed(2)}` : '—'}
                  /
                  ${pos.takeProfit ? `TP $${pos.takeProfit.toFixed(2)}` : '—'}
                </td>
                <td>
                  <button class="danger sm" onclick="openClosePositionTrade('${pos._id}', '${pos.pair}')">
                    Close
                  </button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  } catch (e) {
    el.innerHTML = emptyState('⚠️', 'Could not load positions', e.message || 'Please try again.');
  }
}

window.openClosePositionTrade = async (posId, pair) => {
  try {
    const positions = await api('/api/orders/positions');
    const pos = positions.find(p => p._id === posId);
    if (!pos) return toast('Position not found', 'error');
    const portfolio = await api('/api/portfolio');
    const row = portfolio.pnl?.positions?.find(p => p.pair === pair) || {};
    const pnl = Number(row.unrealized || 0);
    const ok = await confirmAction({
      title: 'Close position',
      message: 'The entire position will be sold at the current market price and the proceeds added to your balance.',
      details: [['Pair', pos.pair], ['Amount', `${pos.amount.toFixed(6)} ${pos.base}`], ['Average cost', `$${pos.avgCost.toFixed(2)}`], ['Current price', `$${(row.currentPrice || pos.avgCost).toFixed(2)}`], ['Unrealized PnL', `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`]],
      confirmText: 'Close position', danger: true
    });
    if (!ok) return;
    await api(`/api/orders/positions/${posId}/close`, { method: 'POST' });
    toast('Position closed', 'success');
    await Promise.all([loadBalances(), loadMyPositions(), loadMyOrders(), loadTradingHistory()]);
  } catch (e) { toast(e.message, 'error'); }
};

// Close modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
  }
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  }
});
