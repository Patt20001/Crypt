const user = requireAuth();
let allTraders = [];
let userBalance = 0;

if (user) document.addEventListener('DOMContentLoaded', init);

async function init() {
  await Promise.all([loadBalance(), loadTraders(), loadMyCopies()]);
}

async function loadBalance() {
  try {
    const b = await api('/api/wallet/balance');
    userBalance = b.balances?.USDT || 0;
  } catch {}
}

async function loadTraders() {
  const el = document.getElementById('traders');
  el.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(4);
  try {
    allTraders = await api('/api/copy');
    applyFilters();
  } catch (e) { toast(e.message, 'error'); }
}

let currentPage = 1;
const PER_PAGE = 20;

window.applyFilters = (resetPage = true) => {
  if (resetPage) currentPage = 1;
  const tier = document.getElementById('filter-tier')?.value || '';
  const sortBy = document.getElementById('sort-by')?.value || 'roi';
  const search = (document.getElementById('search-traders')?.value || '').toLowerCase();

  let list = [...allTraders];
  if (tier) list = list.filter(t => t.tier === tier);
  if (search) list = list.filter(t => t.displayName.toLowerCase().includes(search));

  list.sort((a, b) => {
    if (sortBy === 'roi') return b.roi30d - a.roi30d;
    if (sortBy === 'winRate') return b.winRate - a.winRate;
    if (sortBy === 'followers') return b.followers - a.followers;
    if (sortBy === 'totalTrades') return b.totalTrades - a.totalTrades;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;

  const pageItems = list.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const el = document.getElementById('traders');
  const countEl = document.getElementById('traders-count');
  if (countEl) countEl.textContent = `${list.length} traders · page ${currentPage} of ${totalPages}`;

  if (!pageItems.length) {
    el.innerHTML = '<div class="empty">No traders match your filter</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  el.innerHTML = pageItems.map(t => `
    <div class="card" style="${t.featured ? 'border-color: rgba(74,222,128,.4);' : ''}">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <div class="avatar avatar-lg">${t.displayName[0]}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:16px;">${t.displayName}</div>
          <div class="tag">${t.tier} · ${t.totalTrades} trades</div>
        </div>
        ${t.featured ? '<span class="badge completed">Featured</span>' : ''}
      </div>
      <p class="tag" style="margin-bottom:14px; line-height:1.5;">${t.bio}</p>
      <div class="grid grid-3" style="gap:10px; margin-bottom:16px;">
        <div>
          <div class="tag">30d ROI</div>
          <div style="font-weight:700; font-size:16px; color:${t.roi30d >= 0 ? 'var(--accent)' : '#fca5a5'};">
            ${t.roi30d >= 0 ? '+' : ''}${t.roi30d.toFixed(2)}%
          </div>
        </div>
        <div>
          <div class="tag">Win rate</div>
          <div style="font-weight:700; font-size:16px;">${t.winRate.toFixed(1)}%</div>
        </div>
        <div>
          <div class="tag">Followers</div>
          <div style="font-weight:700; font-size:16px;">${t.followers}</div>
        </div>
      </div>
      <button style="width:100%" onclick="openFollow('${t._id}')">Copy this trader</button>
    </div>`).join('');

  renderPagination(totalPages);
};

window.renderPagination = (totalPages) => {
  const el = document.getElementById('pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const buttons = [];
  const addPage = (p, label = p, active = false) => {
    buttons.push(`<button class="${active ? '' : 'secondary'} sm" onclick="gotoPage(${p})" ${active ? 'disabled' : ''}>${label}</button>`);
  };

  // Prev
  if (currentPage > 1) addPage(currentPage - 1, '← Prev');

  // Page numbers with ellipsis
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === '...') buttons.push('<span class="tag" style="padding:8px;">…</span>');
    else addPage(p, p, p === currentPage);
  });

  // Next
  if (currentPage < totalPages) addPage(currentPage + 1, 'Next →');

  el.innerHTML = `<div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-top: 20px;">${buttons.join('')}</div>`;
};

window.gotoPage = (p) => {
  currentPage = p;
  applyFilters(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function loadMyCopies() {
  const el = document.getElementById('my-copies');
  try {
    const list = await api('/api/copy/my');
    if (!list.length) {
      el.innerHTML = '<div class="empty">You are not copying anyone yet</div>';
      return;
    }
    el.innerHTML = list.map(r => `
      <div class="task" style="flex-direction: column; align-items: stretch; gap: 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600;">${r.trader?.displayName || 'Unknown'}</div>
            <div class="tag">Allocated: ${r.allocation.toFixed(2)} USDT</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700; color: ${r.pnl >= 0 ? 'var(--accent)' : '#fca5a5'};">
              ${r.pnl >= 0 ? '+' : ''}${(r.pnl || 0).toFixed(2)} USDT
            </div>
            <div class="tag">PnL</div>
          </div>
        </div>
        <button class="danger sm" onclick="unfollow('${r._id}')" style="align-self:flex-start;">
          Stop copying
        </button>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

window.openFollow = (traderId) => {
  const t = allTraders.find(x => x._id === traderId);
  if (!t) return;
  document.getElementById('follow-title').textContent = `Copy ${t.displayName}`;
  document.getElementById('follow-body').innerHTML = `
    <p class="tag" style="margin-bottom:14px;">
      Allocate USDT to mirror ${t.displayName}'s trades. You can stop anytime.
    </p>
    <div style="padding:12px; background:rgba(148,163,184,.06); border-radius:10px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between;">
        <span class="tag">Your balance</span>
        <b>${userBalance.toFixed(2)} USDT</b>
      </div>
    </div>
    <label>Allocation (USDT)</label>
    <input id="copy-amount" type="number" min="10" placeholder="100" />
    <p class="tag" style="margin-top:-6px; margin-bottom:14px;">Minimum 10 USDT</p>
    <button style="width:100%" onclick="confirmFollow('${t._id}')">Start copying</button>
  `;
  openModal('follow-modal');
};

window.confirmFollow = async (traderId) => {
  const amt = Number(document.getElementById('copy-amount').value);
  if (!amt || amt < 10) return toast('Minimum allocation is 10 USDT', 'warn');
  try {
    await api(`/api/copy/follow/${traderId}`, {
      method: 'POST',
      body: JSON.stringify({ allocation: amt })
    });
    closeModal('follow-modal');
    toast('You are now copying this trader', 'success');
    await Promise.all([loadBalance(), loadMyCopies(), loadTraders()]);
  } catch (e) { toast(e.message, 'error'); }
};

window.unfollow = async (relId) => {
  if (!confirm('Stop copying this trader? Your allocation + PnL returns to your wallet.')) return;
  try {
    await api(`/api/copy/unfollow/${relId}`, { method: 'POST' });
    toast('Stopped copying', 'success');
    await Promise.all([loadBalance(), loadMyCopies()]);
  } catch (e) { toast(e.message, 'error'); }
};
