const user = requireAuth();
let balances = {};
let quoteRequest = 0;
const ASSETS = ['USDT','BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LTC','TRX','DOT','AVAX','LINK','BCH','TON','NEAR','ATOM','UNI'];
const decimals = currency => currency === 'USDT' ? 2 : 8;
if (user) document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadBalance();
  await loadHistory();
  bindInputs();
  updateQuote();
}
function bindInputs() {
  ['from-amt','from-cur','to-cur'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateQuote);
    document.getElementById(id).addEventListener('change', updateQuote);
  });
}
async function loadBalance() {
  const b = await api('/api/wallet/balance');
  balances = b.balances || {};
  updateBalanceHint();
}
function updateBalanceHint() {
  const cur = document.getElementById('from-cur').value;
  document.getElementById('from-bal').textContent = `${Number(balances[cur] || 0).toFixed(decimals(cur))} ${cur}`;
}
async function updateQuote() {
  const requestId = ++quoteRequest;
  const from = document.getElementById('from-cur').value;
  const to = document.getElementById('to-cur').value;
  const amt = Number(document.getElementById('from-amt').value) || 0;
  updateBalanceHint();
  if (from === to) {
    document.getElementById('to-amt').value = '';
    document.getElementById('rate-line').textContent = 'Pick different currencies';
    document.getElementById('fee-line').textContent = '—';
    return;
  }
  try {
    const q = await api(`/api/swap/quote?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(amt)}`);
    if (requestId !== quoteRequest) return;
    document.getElementById('to-amt').value = q.net.toFixed(decimals(to));
    document.getElementById('rate-line').textContent = `1 ${from} ≈ ${Number(q.rate).toPrecision(7)} ${to}`;
    document.getElementById('fee-line').textContent = `${Number(q.fee).toFixed(decimals(to))} ${to}`;
    const source = document.getElementById('quote-source');
    if (source) source.textContent = `${q.priceSource || 'Reference prices'} · prices may change before execution`;
  } catch (e) {
    if (requestId !== quoteRequest) return;
    document.getElementById('to-amt').value = '';
    document.getElementById('rate-line').textContent = e.message || 'Quote unavailable';
    document.getElementById('fee-line').textContent = '—';
  }
}
window.flipCurrencies = () => {
  const a = document.getElementById('from-cur');
  const b = document.getElementById('to-cur');
  [a.value, b.value] = [b.value, a.value];
  updateQuote();
};
window.doSwap = async () => {
  const from = document.getElementById('from-cur').value;
  const to = document.getElementById('to-cur').value;
  const amount = Number(document.getElementById('from-amt').value);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Enter a valid amount', 'warn');
  if (from === to) return toast('Pick different currencies', 'warn');
  if (amount > Number(balances[from] || 0)) return toast(`Insufficient ${from} balance`, 'warn');
  const receive = document.getElementById('to-amt').value;
  if (!receive) return toast('Waiting for a quote. Please try again in a moment.', 'warn');
  const ok = await confirmAction({
    title: 'Confirm swap',
    message: 'The final amount may differ slightly if the market moves before execution.',
    details: [['You pay', `${amount} ${from}`], ['You receive (est.)', `${receive} ${to}`], ['Rate', document.getElementById('rate-line').textContent], ['Fee (0.5%)', document.getElementById('fee-line').textContent]],
    confirmText: 'Confirm swap'
  });
  if (!ok) return;
  await withBusy(document.querySelector('button[onclick="doSwap()"]'), 'Swapping…', async () => {
    try {
      const r = await api('/api/swap', { method: 'POST', body: JSON.stringify({ from, to, amount }) });
      toast(`Swapped ${amount} ${from} → ${Number(r.swap.toAmount).toFixed(decimals(to))} ${to}`, 'success');
      document.getElementById('from-amt').value = '';
      await Promise.all([loadBalance(), loadHistory()]);
      await updateQuote();
    } catch (e) { toast(e.message, 'error'); }
  });
};
async function loadHistory() {
  const el = document.getElementById('history');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const swaps = await api('/api/swap/history');
    if (!swaps.length) { el.innerHTML = emptyState('🔄', 'No swaps yet', 'Your completed swaps will appear here.'); return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Pair</th><th>Amount</th><th>Received</th></tr></thead><tbody>${swaps.slice(0,10).map(s => `<tr><td>${new Date(s.createdAt).toLocaleString()}</td><td>${s.from} → ${s.to}</td><td>${Number(s.fromAmount).toFixed(decimals(s.from))} ${s.from}</td><td style="color:var(--accent);font-weight:600;">${Number(s.toAmount).toFixed(decimals(s.to))} ${s.to}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load swap history', e.message || 'Please try again.'); }
}
