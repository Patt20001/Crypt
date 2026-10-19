const user = requireAuth();
let currentPair = 'BTC/USDT';
let currentSide = 'buy';
let bookInterval = null;
let tradesInterval = null;
let balances = { USDT: 0, BTC: 0, ETH: 0 };

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  await loadBalances();
  await loadMyOrders();

  // Initialize chart FIRST so it has a canvas to draw into
  if (window.initTradeChart) {
    await window.initTradeChart(currentPair);
  }

  // Then select the pair (which triggers book/trades loading)
  await selectPair(currentPair);

  bookInterval = setInterval(refreshBook, 2000);
  tradesInterval = setInterval(refreshTrades, 5000);
}

window.selectPair = async function (pair) {
  currentPair = pair;
  document.querySelectorAll('[data-pair]').forEach(el => {
    el.classList.toggle('active', el.dataset.pair === pair);
  });

  await Promise.all([refreshBook(), refreshTrades()]);
  updateSubmitLabel();
  updateAvailHint();

  // Switch the chart AFTER init completes (guard with await)
  if (window.switchTradePair) {
    await window.switchTradePair(pair);
  }
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
  const price = Number(document.getElementById('order-price').value) || 0;
  const amt = Number(document.getElementById('order-amount').value) || 0;
  const total = price * amt;
  document.getElementById('order-total').textContent = `${total.toFixed(2)} USDT`;
};

async function refreshBook() {
  try {
    const data = await api(`/api/orders/book/${currentPair.replace('/', '-')}`);
    document.getElementById('pair-price').textContent = `$${data.mid.toLocaleString()}`;

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
      el.innerHTML = '<div class="empty">No orders yet</div>';
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
  if (!price || price <= 0) return toast('Enter a valid price', 'warn');
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');

  const btn = document.getElementById('btn-submit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Placing…';

  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ side: currentSide, pair: currentPair, type: 'limit', price, amount })
    });
    toast('Order placed', 'success');
    document.getElementById('order-amount').value = '';
    document.getElementById('order-total').textContent = '0.00 USDT';
    await Promise.all([loadBalances(), loadMyOrders()]);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
};

window.cancelOrder = async (id) => {
  if (!confirm('Cancel this order?')) return;
  try {
    await api(`/api/orders/${id}/cancel`, { method: 'POST' });
    toast('Order cancelled', 'success');
    await Promise.all([loadBalances(), loadMyOrders()]);
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
