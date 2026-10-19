/* ============================================================
   NovaWallet — Wallet page controller
   Handles: networks, deposit QR, withdraw, address book, limits
   ============================================================ */

const user = requireAuth();

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

// Hardcoded fallback so page always renders even if /api/networks fails
const FALLBACK_NETWORKS = [
  { id: 'TRC20', name: 'Tron (TRC20)',    symbol: 'USDT', minDeposit: 1,  minWithdraw: 10, fee: 1,   confirmations: 19, color: '#ef4444' },
  { id: 'ERC20', name: 'Ethereum (ERC20)',symbol: 'USDT', minDeposit: 10, minWithdraw: 20, fee: 8,   confirmations: 12, color: '#627eea' },
  { id: 'BEP20', name: 'BNB Chain (BEP20)',symbol: 'USDT',minDeposit: 1,  minWithdraw: 5,  fee: 0.5, confirmations: 15, color: '#f0b90b' },
  { id: 'SOL',   name: 'Solana (SPL)',    symbol: 'USDT', minDeposit: 1,  minWithdraw: 1,  fee: 0.1, confirmations: 1,  color: '#14f195' }
];

let networks = FALLBACK_NETWORKS;
let selectedNet = FALLBACK_NETWORKS[0];
let qrInstance = null;

if (user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  // 1. Networks — try API, fall back to hardcoded
  try {
    const fromApi = await api('/api/networks');
    if (Array.isArray(fromApi) && fromApi.length) {
      networks = fromApi;
      selectedNet = networks[0];
    }
  } catch (e) {
    console.warn('Using fallback networks:', e.message);
  }

  renderNetworks();
  renderNetworkDetail();

  // 2. Everything else in parallel, each wrapped so one failure doesn't kill the rest
  await Promise.allSettled([
    loadBalance(),
    loadTxs(),
    loadLimits(),
    loadAddressBook()
  ]);

  // 3. Fee line live-updates
  const amtInput = document.getElementById('w-amt');
  if (amtInput) amtInput.addEventListener('input', updateFeeLine);
  updateFeeLine();
}

/* ---------------- NETWORKS ---------------- */
function renderNetworks() {
  const el = document.getElementById('networks');
  if (!el) return;
  el.innerHTML = networks.map(n => `
    <div class="net-chip ${n.id === selectedNet.id ? 'active' : ''}" data-net="${n.id}">
      <span class="net-dot" style="background:${n.color}; color:${n.color};"></span>
      ${n.name}
    </div>`).join('');
  el.querySelectorAll('.net-chip').forEach(c => {
    c.addEventListener('click', () => {
      selectedNet = networks.find(x => x.id === c.dataset.net) || selectedNet;
      renderNetworks();
      renderNetworkDetail();
      updateFeeLine();
    });
  });
}

function renderNetworkDetail() {
  const depSym  = document.getElementById('dep-sym');
  const depNet  = document.getElementById('dep-net');
  const depMin  = document.getElementById('dep-min');
  const depConf = document.getElementById('dep-conf');
  const addrEl  = document.getElementById('dep-addr');

  if (depSym)  depSym.textContent  = selectedNet.symbol;
  if (depNet)  depNet.textContent  = selectedNet.id;
  if (depMin)  depMin.textContent  = selectedNet.minDeposit;
  if (depConf) depConf.textContent = selectedNet.confirmations;

  const address = user.walletAddress || 'N/A';
  if (addrEl) addrEl.textContent = address;

  // QR
  const qrEl = document.getElementById('qr');
  if (!qrEl) return;
  qrEl.innerHTML = '';
  const payload = `${selectedNet.id}:${address}`;

  if (window.QRCode) {
    try {
      qrInstance = new QRCode(qrEl, {
        text: payload,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (e) {
      qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}" alt="QR" />`;
    }
  } else {
    // Fallback to public QR image API
    qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}" alt="QR" />`;
  }
}

/* ---------------- BALANCE ---------------- */
async function loadBalance() {
  try {
    const b = await api('/api/wallet/balance');
    const avail = document.getElementById('w-avail');
    if (avail) avail.textContent = `${(b.balances?.USDT || 0).toFixed(2)} USDT`;
  } catch (e) { console.warn('loadBalance:', e.message); }
}

/* ---------------- LIMITS ---------------- */
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
            <div style="font-weight: 600;">Daily withdrawal limit</div>
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

/* ---------------- ADDRESS BOOK ---------------- */
async function loadAddressBook() {
  try {
    const list = await api('/api/addresses');
    const sel = document.getElementById('addr-book');
    if (!sel) return;
    sel.innerHTML = '<option value="">Address book</option>' +
      list.map(a => `<option value="${a.address}">${a.label} · ${a.network}</option>`).join('');
  } catch (e) { console.warn('loadAddressBook:', e.message); }
}

window.pickAddress = function (addr) {
  if (addr) {
    const input = document.getElementById('w-addr');
    if (input) input.value = addr;
    toast('Address loaded', 'success', 1200);
  }
};

window.saveAddress = async function () {
  const input = document.getElementById('w-addr');
  const address = (input?.value || '').trim();
  if (!address) return toast('Enter an address first', 'warn');
  const label = prompt('Label for this address', 'My wallet');
  if (!label) return;
  try {
    await api('/api/addresses', {
      method: 'POST',
      body: JSON.stringify({ label, address, network: selectedNet.id })
    });
    toast('Address saved', 'success');
    loadAddressBook();
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------------- FEE LINE ---------------- */
function updateFeeLine() {
  if (!selectedNet) return;
  const amtInput = document.getElementById('w-amt');
  const amt = Number(amtInput?.value) || 0;
  const feeEl = document.getElementById('fee-line');
  const recvEl = document.getElementById('you-receive');
  if (feeEl) feeEl.textContent = `${selectedNet.fee} USDT (${selectedNet.id})`;
  if (recvEl) recvEl.textContent = `≈ ${Math.max(0, amt - selectedNet.fee).toFixed(2)} USDT`;
}

/* ---------------- COPY ADDRESS ---------------- */
window.copyAddr = function () {
  const addr = user.walletAddress || '';
  if (!addr) return;
  navigator.clipboard.writeText(addr);
  toast('Address copied', 'success', 1500);
};

window.deposit = async function () {
  const btn = document.getElementById('btn-deposit');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    await api('/api/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({
        currency: 'USDT',
        network: selectedNet.id,
        note: ''
      })
    });
    toast('Deposit submitted — awaiting network confirmation', 'success');
    loadTxs();
    loadLimits();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'I have sent the funds'; }
  }
};

/* ============================================================
   WITHDRAW — Step 1: validate & open the confirm modal
   ============================================================ */
window.withdraw = async function () {
  const btn = document.getElementById('btn-withdraw');
  const amount = Number(document.getElementById('w-amt')?.value);
  const address = (document.getElementById('w-addr')?.value || '').trim();

  // validation
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'warn');
  if (!address || address.length < 10) return toast('Enter a valid destination address', 'warn');
  if (amount < selectedNet.minWithdraw) return toast(`Minimum withdrawal is ${selectedNet.minWithdraw} USDT`, 'warn');

  // check if 2FA is on
  let me = null;
  try {
    me = await api('/api/auth/me').then(r => r.user);
  } catch {}

  if (!me) return toast('Could not verify your account', 'error');

  if (me.twoFA) {
    // Open the 2FA modal
    document.getElementById('wd-summary-amount').textContent = `${amount} USDT`;
    document.getElementById('wd-summary-network').textContent = selectedNet.id;
    document.getElementById('wd-summary-address').textContent = address;
    document.getElementById('withdraw-2fa-code').value = '';
    document.getElementById('withdraw-2fa-msg').textContent = '';
    openModal('withdraw-2fa-modal');
    setTimeout(() => document.getElementById('withdraw-2fa-code').focus(), 150);
  } else {
    // No 2FA — submit directly
    await submitWithdrawal({ amount, address, code: undefined });
  }
};

/* ============================================================
   WITHDRAW — Step 2a: user confirmed the modal
   ============================================================ */
window.confirmWithdrawal = async function () {
  const code = document.getElementById('withdraw-2fa-code').value.trim();
  const msg = document.getElementById('withdraw-2fa-msg');

  if (!code) {
    msg.className = 'error';
    msg.textContent = 'Enter the 6-digit code';
    return;
  }

  const amount = Number(document.getElementById('w-amt')?.value);
  const address = (document.getElementById('w-addr')?.value || '').trim();

  msg.className = '';
  msg.textContent = 'Verifying…';

  await submitWithdrawal({ amount, address, code, msgEl: msg });
};

/* ============================================================
   WITHDRAW — Step 2b: user cancelled the modal
   ============================================================ */
window.cancelWithdrawal = function () {
  closeModal('withdraw-2fa-modal');
};

/* ============================================================
   WITHDRAW — actual submission (used by both paths)
   ============================================================ */
async function submitWithdrawal({ amount, address, code, msgEl }) {
  const btn = document.getElementById('btn-withdraw');
  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    await api('/api/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: 'USDT',
        address,
        code,
        note: `via ${selectedNet.id}`
      })
    });

    // success
    closeModal('withdraw-2fa-modal');
    toast('Withdrawal submitted — processing', 'success');
    document.getElementById('w-amt').value = '';
    document.getElementById('w-addr').value = '';
    loadTxs();
    loadLimits();
  } catch (e) {
    if (msgEl) {
      msgEl.className = 'error';
      msgEl.textContent = e.message;
    } else {
      toast(e.message, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText || 'Request Withdrawal'; }
  }
}

/* ---------------- TRANSACTION HISTORY ---------------- */
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
          <tr><th>Date</th><th>Type</th><th>Currency</th><th>Amount</th><th>Status</th><th>Details</th></tr>
        </thead>
        <tbody>${txs.map(t => {
          const isPendingDeposit = t.type === 'deposit' && t.status === 'pending';
          const amountCell = isPendingDeposit
            ? '<span class="tag">Awaiting confirmation</span>'
            : `<span style="font-weight:600;">${t.amount}</span>`;

          return `
            <tr class="tx-row" onclick="openTxDetail('${t._id}')">
              <td>${new Date(t.createdAt).toLocaleString()}</td>
              <td style="text-transform: capitalize;">${t.type}</td>
              <td>${t.currency}</td>
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

/* ---------------- TX DETAIL MODAL ---------------- */
window.openTxDetail = async function (txId) {
  const modal = document.getElementById('tx-modal');
  const body = document.getElementById('tx-detail-content');
  if (!modal || !body) return;
  modal.classList.add('open');
  body.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);

  try {
    const t = await api(`/api/wallet/transactions/${txId}`);
    const fakeHash = '0x' + Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
    const explorer = {
      TRC20: 'https://tronscan.org/#/transaction/',
      ERC20: 'https://etherscan.io/tx/',
      BEP20: 'https://bscscan.com/tx/',
      SOL:   'https://solscan.io/tx/'
    }[t.network || 'TRC20'] || 'https://tronscan.org/#/transaction/';

    body.innerHTML = `
      <div class="row"><div class="row-label">Type</div><div class="row-sub" style="text-transform: capitalize;">${t.type}</div></div>
      <div class="row"><div class="row-label">Amount</div><div class="row-sub" style="font-weight:600;">${t.amount} ${t.currency}</div></div>
      <div class="row"><div class="row-label">Status</div><div class="row-sub"><span class="badge ${t.status}">${t.status}</span></div></div>
      <div class="row"><div class="row-label">Network</div><div class="row-sub">${t.network || 'TRC20'}</div></div>
      ${t.address ? `<div class="row"><div class="row-label">Address</div><div class="row-sub tx-hash">${t.address}</div></div>` : ''}
      <div class="row"><div class="row-label">Created</div><div class="row-sub">${new Date(t.createdAt).toLocaleString()}</div></div>
      <div class="row"><div class="row-label">Tx hash</div><div class="row-sub tx-hash">${fakeHash}</div></div>
      <div style="margin-top: 14px;">
        <a class="btn secondary sm" href="${explorer}${fakeHash}" target="_blank">View on explorer ↗</a>
      </div>
      <div class="timeline">
        <div class="timeline-step"><span class="timeline-dot done"></span>Created</div>
        <div class="timeline-step"><span class="timeline-dot ${t.status === 'pending' ? 'current' : 'done'}"></span>Processing</div>
        <div class="timeline-step"><span class="timeline-dot ${t.status === 'completed' ? 'done' : ''}"></span>${t.status === 'rejected' ? 'Rejected' : 'Completed'}</div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="empty">${e.message}</div>`;
  }
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
