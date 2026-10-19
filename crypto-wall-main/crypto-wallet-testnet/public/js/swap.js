const user = requireAuth();
let balances = { USDT: 0, BTC: 0, ETH: 0 };

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  await loadBalance();
  await loadHistory();
  bindInputs();
  updateQuote();
}

function bindInputs() {
  ['from-amt', 'from-cur', 'to-cur'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateQuote);
    document.getElementById(id).addEventListener('change', updateQuote);
  });
}

async function loadBalance() {
  const b = await api('/api/wallet/balance');
  balances = b.balances;
  updateBalanceHint();
}

function updateBalanceHint() {
  const cur = document.getElementById('from-cur').value;
  document.getElementById('from-bal').textContent =
    (balances[cur] || 0).toFixed(cur === 'USDT' ? 2 : 6) + ' ' + cur;
}

async function updateQuote() {
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
    const q = await api(`/api/swap/quote?from=${from}&to=${to}&amount=${amt}`);
    document.getElementById('to-amt').value = q.net.toFixed(to === 'USDT' ? 2 : 6);
    document.getElementById('rate-line').textContent =
      `1 ${from} ≈ ${q.rate.toFixed(6)} ${to}`;
    document.getElementById('fee-line').textContent =
      `${q.fee.toFixed(6)} ${to}`;
  } catch (e) {
    document.getElementById('to-amt').value = '';
    document.getElementById('rate-line').textContent = '—';
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
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  if (from === to) return toast('Pick different currencies', 'warn');

  try {
    const r = await api('/api/swap', {
      method: 'POST',
      body: JSON.stringify({ from, to, amount })
    });
    toast(`Swapped ${amount} ${from} → ${r.swap.toAmount.toFixed(6)} ${to}`, 'success');
    document.getElementById('from-amt').value = '';
    await loadBalance();
    await updateQuote();
    await loadHistory();
  } catch (e) { toast(e.message, 'error'); }
};

async function loadHistory() {
  const el = document.getElementById('history');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const swaps = await api('/api/swap/history');
    if (!swaps.length) {
      el.innerHTML = '<div class="empty">No swaps yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Pair</th><th>Amount</th><th>Received</th></tr></thead>
        <tbody>
          ${swaps.slice(0, 10).map(s => `
            <tr>
              <td>${new Date(s.createdAt).toLocaleString()}</td>
              <td>${s.from} → ${s.to}</td>
              <td>${s.fromAmount}</td>
              <td style="color: var(--accent); font-weight: 600;">${s.toAmount.toFixed(6)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}