const user = requireAuth();

let networks = [];           // full list from /api/networks
let balances = {};
let depositAddresses = {};
let selectedAsset = 'USDT';
let selectedNetwork = null;

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  try {
    networks = await api('/api/networks');
  } catch {
    networks = [];
  }

  renderAssetSelector();
  await loadBalance();
  selectAsset('USDT');

  await Promise.allSettled([loadTxs(), loadLimits(), loadAddressBook()]);

  const amtInput = document.getElementById('w-amt');
  if (amtInput) amtInput.addEventListener('input', updateFeeLine);
}

/* ============================================================
   ASSET SELECTOR (currencies the user has + all supported)
   ============================================================ */
function renderAssetSelector() {
  const el = document.getElementById('asset-selector');
  if (!el) return;

  const allAssets = new Set();
  networks.forEach(n => n.currencies.forEach(c => allAssets.add(c.symbol)));
  const sorted = [...allAssets].sort();

  el.innerHTML = sorted.map(sym => `
    <div class="net-chip ${selectedAsset === sym ? 'active' : ''}" data-asset="${sym}" onclick="selectAsset('${sym}')">
      ${sym}
      <span class="tag" style="margin-left: 6px;">${(balances[sym] || 0).toFixed(sym === 'USDT' ? 2 : 6)}</span>
    </div>`).join('');
}

/* ============================================================
   NETWORK SELECTOR (only networks supporting selected asset)
   ============================================================ */
function renderNetworkSelector() {
  const el = document.getElementById('network-selector');
  if (!el) return;

  const valid = networks.filter(n =>
    n.currencies.some(c => c.symbol === selectedAsset)
  );

  if (!valid.length) {
    el.innerHTML = '<div class="empty">No networks support this asset</div>';
    return;
  }

  el.innerHTML = valid.map(n => {
    const isActive = selectedNetwork && selectedNetwork.id === n.id;
    return `
      <div class="net-chip ${isActive ? 'active' : ''}" data-net="${n.id}" onclick="selectNetwork('${n.id}')">
        <span class="net-dot" style="background:${n.color}; color:${n.color};"></span>
        ${n.name}
      </div>`;
  }).join('');
}

function selectAsset(sym) {
  selectedAsset = sym;
  renderAssetSelector();

  // Pick first network that supports this asset
  const valid = networks.filter(n => n.currencies.some(c => c.symbol === sym));
  selectedNetwork = valid[0] || null;

  renderNetworkSelector();
  renderAssetDetail();
  updateFeeLine();
}

function selectNetwork(id) {
  selectedNetwork = networks.find(n => n.id === id) || null;
  renderNetworkSelector();
  renderAssetDetail();
  updateFeeLine();
}

/* ============================================================
   RENDER DETAILS (deposit QR, min, fee, balance)
   ============================================================ */
function renderAssetDetail() {
  if (!selectedNetwork) return;

  const c = selectedNetwork.currencies.find(x => x.symbol === selectedAsset);
  if (!c) return;

  const net = selectedNetwork;
  const decimals = c.decimals ?? 2;

  // Deposit
  document.getElementById('dep-currency-label').textContent = selectedAsset;
  document.getElementById('dep-sym').textContent = selectedAsset;
  document.getElementById('dep-sym2').textContent = selectedAsset;
  document.getElementById('dep-net').textContent = net.id;
  document.getElementById('dep-min').textContent = c.minDeposit;
  document.getElementById('dep-conf').textContent = net.confirmations;

  const addr = depositAddresses[net.id] || '—';
  document.getElementById('dep-addr').textContent = addr;

  // QR
  const qrEl = document.getElementById('qr');
  qrEl.innerHTML = '';
  const payload = `${selectedAsset}:${net.id}:${addr}`;
  if (window.QRCode) {
    try {
      new QRCode(qrEl, {
        text: payload, width: 180, height: 180,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch {
      qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}" alt="QR" />`;
    }
  } else {
    qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}" alt="QR" />`;
  }

  // Withdraw
  document.getElementById('wd-currency-label').textContent = selectedAsset;
  document.getElementById('wd-sym').textContent = selectedAsset;
  document.getElementById('w-avail').textContent =
    `${(balances[selectedAsset] || 0).toFixed(decimals)} ${selectedAsset}`;
}

function updateFeeLine() {
  if (!selectedNetwork) return;
  const c = selectedNetwork.currencies.find(x => x.symbol === selectedAsset);
  if (!c) return;

  const amt = Number(document.getElementById('w-amt')?.value) || 0;
  const decimals = c.decimals ?? 2;
  document.getElementById('fee-line').textContent =
    `${c.fee} ${selectedAsset} (${selectedNetwork.id})`;
  document.getElementById('you-receive').textContent =
    `≈ ${Math.max(0, amt - c.fee).toFixed(decimals)} ${selectedAsset}`;
}

/* ============================================================
   BALANCE
   ============================================================ */
async function loadBalance() {
  try {
    const b = await api('/api/wallet/balance');
    balances = b.balances || {};
    depositAddresses = b.depositAddresses || {};
    renderAssetSelector();
    if (selectedNetwork) renderAssetDetail();
  } catch (e) { console.warn('loadBalance:', e.message); }
}

/* ============================================================
   LIMITS
   ============================================================ */
async function loadLimits() {
  const el = document.getElementById('limits-banner');
  if (!el) return;
  try {
    const L = await api('/api/wallet/limits');
    if (L.limit === null) {
      el.innerHTML = `<div class="broadcast" style="--broadcast-icon: none;">✅ Verified account · no daily withdrawal limit</div>`;
    } else {
      const pct = L.limit > 0 ? Math.min(100, (L.used / L.limit) * 100) : 0;
      el.innerHTML = `
        <div class="card" style="margin-bottom: 18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
            <div style="font-weight: 600;">Daily USDT withdrawal limit</div>
            <div class="tag">${L.used.toFixed(2)} / ${L.limit} USDT</div>
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <p class="tag" style="margin-top:8px;">
            ${L.remaining.toFixed(2)} USDT remaining today ·
            <a href="/profile.html">Upgrade KYC</a> for higher limits
          </p>
        </div>`;
    }
  } catch (e) { console.warn('loadLimits:', e.message); }
}

/* ============================================================
   ADDRESS BOOK
   ============================================================ */
async function loadAddressBook() {
  try {
    const list = await api('/api/addresses');
    const sel = document.getElementById('addr-book');
    if (!sel) return;
    sel.innerHTML = '<option value="">Address book</option>' +
      list.map(a => `<option value="${a.address}">${a.label} · ${a.network}</option>`).join('');
  } catch {}
}

window.pickAddress = (addr) => {
  if (addr) {
    document.getElementById('w-addr').value = addr;
    toast('Address loaded', 'success', 1200);
  }
};

window.saveAddress = async () => {
  const address = document.getElementById('w-addr').value.trim();
  if (!address) return toast('Enter an address first', 'warn');
  const label = prompt('Label for this address', 'My wallet');
  if (!label) return;
  try {
    await api('/api/addresses', {
      method: 'POST',
      body: JSON.stringify({ label, address, network: selectedNetwork?.id })
    });
    toast('Address saved', 'success');
    loadAddressBook();
  } catch (e) { toast(e.message, 'error'); }
};

/* ============================================================
   COPY ADDRESS
   ============================================================ */
window.copyAddr = () => {
  const addr = depositAddresses[selectedNetwork?.id];
  if (!addr) return;
  navigator.clipboard.writeText(addr);
  toast('Address copied', 'success', 1500);
};

/* ============================================================
   DEPOSIT
   ============================================================ */
window.deposit = async () => {
  const btn = document.getElementById('btn-deposit');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    await api('/api/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({
        currency: selectedAsset,
        network: selectedNetwork.id
      })
    });
    toast(`${selectedAsset} deposit submitted — awaiting confirmation`, 'success');
    loadTxs();
    loadLimits();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'I have sent the funds'; }
  }
};

/* ============================================================
   WITHDRAW
   ============================================================ */
window.withdraw = async () => {
  const btn = document.getElementById('btn-withdraw');
  const amount = Number(document.getElementById('w-amt')?.value);
  const address = (document.getElementById('w-addr')?.value || '').trim();

  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  if (!address || address.length < 10) return toast('Enter a valid destination address', 'warn');

  const c = selectedNetwork.currencies.find(x => x.symbol === selectedAsset);
  if (!c) return;
  if (amount < c.minWithdraw)
    return toast(`Minimum withdrawal is ${c.minWithdraw} ${selectedAsset}`, 'warn');

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    let code;
    try {
      const me = await api('/api/auth/me').then(r => r.user);
      if (me.twoFA) {
        code = prompt('Enter the current 6-digit code from your authenticator app');
        if (!code) {
          if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; }
          return;
        }
      }
    } catch {}

    await api('/api/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: selectedAsset,
        address,
        code,
        note: `via ${selectedNetwork.id}`
      })
    });

    toast('Withdrawal submitted — processing', 'success');
    document.getElementById('w-amt').value = '';
    document.getElementById('w-addr').value = '';
    loadTxs();
    loadLimits();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Request Withdrawal'; }
  }
};

/* ============================================================
   TRANSACTION HISTORY
   ============================================================ */
async function loadTxs() {
  const el = document.getElementById('txs');
  if (!el) return;
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(4);
  try {
    const txs = await api('/api/wallet/transactions');
    if (!txs.length) {
      el.innerHTML = '<div class="empty">No transactions yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead>
          <tr><th>Date</th><th>Type</th><th>Currency</th><th>Network</th><th>Amount</th><th>Status</th><th>Details</th></tr>
        </thead>
        <tbody>${txs.map(t => {
          const isPendingDeposit = t.type === 'deposit' && t.status === 'pending';
          const amountCell = isPendingDeposit
            ? '<span class="tag">Awaiting confirmation</span>'
            : `<span style="font-weight:600;">${t.amount}</span>`;

          return `
            <tr>
              <td>${new Date(t.createdAt).toLocaleString()}</td>
              <td style="text-transform: capitalize;">${t.type}</td>
              <td>${t.currency}</td>
              <td class="tag">${t.network || '—'}</td>
              <td>${amountCell}</td>
              <td><span class="badge ${t.status}">${t.status}</span></td>
              <td class="tag">${t.note || t.address || '-'}</td>
            </tr>`;
        }).join('')}
        </tbody></table></div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">Could not load transactions: ${e.message}</div>`;
  }
}