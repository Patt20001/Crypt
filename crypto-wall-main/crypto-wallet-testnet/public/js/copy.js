const user = requireAuth();
let allTraders = [];
let userBalance = 0;
let currentPage = 1;
const PER_PAGE = 20;
let profileTraderId = null;
let profileHistoryDays = 30;
let platformFeePercent = null;
let lastTradersSig = '';

// Only touch the DOM when the rendered markup actually changed (prevents flicker on refresh).
const setHTML = (el, html) => { if (!el || el._last === html) return false; el.innerHTML = html; el._last = html; return true; };

const safeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => Number(value || 0).toFixed(2);

if (user) document.addEventListener('DOMContentLoaded', init);

async function init() {
  await Promise.all([loadBalance(), loadFees(), loadTraders(), loadMyCopies(), loadLeaderboard()]);
  setInterval(() => {
    if (document.hidden) return;
    if (document.querySelector('.modal.open')) return;
    if (document.getElementById('traders')?.matches(':hover')) return;
    loadTraders(); loadMyCopies(); loadLeaderboard();
  }, 30000);
}

async function loadFees() {
  try { const f = await api('/api/copy/fees'); platformFeePercent = f.platformFeePercent; } catch {}
}

async function loadBalance() {
  try { const b = await api('/api/wallet/balance'); userBalance = Number(b.balances?.USDT || 0); } catch {}
}

async function loadTraders() {
  const el = document.getElementById('traders');
  if (!allTraders.length && el) el.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(4);
  try {
    const data = await api('/api/copy');
    const sig = JSON.stringify(data);
    if (sig === lastTradersSig && allTraders.length) return;
    lastTradersSig = sig; allTraders = data; applyFilters(false);
  } catch (e) { if (el && !allTraders.length) el.innerHTML = '<div class="empty">Could not load traders</div>'; toast(e.message, 'error'); }
}

window.applyFilters = (resetPage = true) => {
  if (resetPage) currentPage = 1;
  const tier = document.getElementById('filter-tier')?.value || '';
  const sortBy = document.getElementById('sort-by')?.value || 'roi';
  const search = (document.getElementById('search-traders')?.value || '').trim().toLowerCase();
  let list = [...allTraders];
  if (tier) list = list.filter(t => t.tier === tier);
  if (search) list = list.filter(t => `${t.displayName || ''} ${t.bio || ''}`.toLowerCase().includes(search));
  list.sort((a, b) => sortBy === 'roi' ? Number(b.roi30d) - Number(a.roi30d)
    : sortBy === 'winRate' ? Number(b.winRate) - Number(a.winRate)
    : sortBy === 'followers' ? Number(b.followers) - Number(a.followers)
    : Number(b.totalTrades) - Number(a.totalTrades));

  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  currentPage = Math.min(currentPage, totalPages);
  const pageItems = list.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
  const el = document.getElementById('traders');
  const countEl = document.getElementById('traders-count');
  if (countEl) countEl.textContent = `${list.length} traders · page ${currentPage} of ${totalPages}`;
  if (!el) return;
  if (!pageItems.length) { el._last = null; el.innerHTML = '<div class="empty">No traders match your filter</div>'; document.getElementById('pagination').innerHTML = ''; return; }

  const gridHTML = pageItems.map(t => `
    <article class="card trader-card ${t.featured ? 'trader-featured' : ''}" role="button" tabindex="0"
      aria-label="View ${safeText(t.displayName)} profile" onclick="openTraderProfile('${t._id}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openTraderProfile('${t._id}');}">
      <div class="trader-card-head"><div class="avatar avatar-lg">${safeText((t.displayName || '?')[0].toUpperCase())}</div>
        <div style="flex:1;min-width:0;"><div class="trader-name">${safeText(t.displayName)}</div><div class="tag">${safeText(t.tier)} · ${Number(t.totalTrades || 0).toLocaleString()} trades</div></div>
        ${t.featured ? '<span class="badge completed">Featured</span>' : ''}
      </div>
      <p class="tag trader-bio">${safeText(t.bio)}</p>
      <div class="grid grid-3 trader-metrics">
        <div><div class="tag">30d ROI</div><div class="trader-metric ${Number(t.roi30d) >= 0 ? 'positive' : 'negative'}">${Number(t.roi30d) >= 0 ? '+' : ''}${fmt(t.roi30d)}%</div></div>
        <div><div class="tag">Win rate</div><div class="trader-metric">${fmt(t.winRate)}%</div></div>
        <div><div class="tag">Followers</div><div class="trader-metric">${Number(t.followers || 0).toLocaleString()}</div></div>
      </div>
      <div class="trader-card-foot"><span>Performance fee</span><b>${Number(t.performanceFee ?? 10)}%</b></div>
      <button style="width:100%" onclick="event.stopPropagation();openFollow('${t._id}')">Copy this trader</button>
      <div class="tag trader-view-hint">View profile &amp; performance history →</div>
    </article>`).join('');
  setHTML(el, gridHTML);
  renderPagination(totalPages);
};

window.renderPagination = totalPages => {
  const el = document.getElementById('pagination'); if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const buttons = [];
  const add = (p, label = p, active = false) => buttons.push(`<button class="${active ? '' : 'secondary'} sm" onclick="gotoPage(${p})" ${active ? 'disabled' : ''}>${label}</button>`);
  if (currentPage > 1) add(currentPage - 1, '← Prev');
  const pages = [];
  if (totalPages <= 7) for (let i = 1; i <= totalPages; i++) pages.push(i);
  else { pages.push(1); if (currentPage > 3) pages.push('…'); for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i); if (currentPage < totalPages - 2) pages.push('…'); pages.push(totalPages); }
  pages.forEach(p => p === '…' ? buttons.push('<span class="tag">…</span>') : add(p, p, p === currentPage));
  if (currentPage < totalPages) add(currentPage + 1, 'Next →');
  el.innerHTML = `<div class="copy-pagination">${buttons.join('')}</div>`;
};
window.gotoPage = p => { currentPage = p; applyFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

async function loadMyCopies() {
  const el = document.getElementById('my-copies'); if (!el) return;
  try {
    const list = await api('/api/copy/my');
    if (!list.length) { setHTML(el, '<div class="empty">You are not copying anyone yet</div>'); return; }
    setHTML(el, list.map(r => {
      const traderRoi = Number(r.trader?.roi30d || 0);
      const pnl = Number(r.pnl || 0);
      return `<div class="task copy-active-row" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div class="copy-active-head"><div><div style="font-weight:600;">${safeText(r.trader?.displayName || 'Unknown')}</div><div class="tag">Allocated: ${fmt(r.allocation)} USDT</div></div>
          <div style="text-align:right;"><div class="copy-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} USDT</div><div class="tag">Follower PnL</div></div></div>
        <div class="copy-active-metrics"><div><span class="tag">30d ROI</span><b class="${traderRoi >= 0 ? 'positive' : 'negative'}">${traderRoi >= 0 ? '+' : ''}${fmt(traderRoi)}%</b></div>
          <div><span class="tag">Win rate</span><b>${fmt(r.trader?.winRate)}%</b></div><div><span class="tag">Followers</span><b>${Number(r.trader?.followers || 0).toLocaleString()}</b></div></div>
        <button class="danger sm" onclick="unfollow('${r._id}')" style="align-self:flex-start;">Stop copying</button>
      </div>`;
    }).join(''));
  } catch (e) { toast(e.message, 'error'); }
}

window.openTraderProfile = async traderId => {
  profileTraderId = traderId; profileHistoryDays = 30;
  document.getElementById('trader-profile-title').textContent = 'Trader profile';
  document.getElementById('trader-profile-body').innerHTML = '<div class="skeleton skeleton-card"></div>';
  openModal('trader-profile-modal');
  try {
    const t = await api(`/api/copy/${traderId}/profile`);
    document.getElementById('trader-profile-title').textContent = t.displayName;
    document.getElementById('trader-profile-body').innerHTML = `
      <div class="profile-hero"><div class="avatar avatar-lg">${safeText((t.displayName || '?')[0].toUpperCase())}</div><div><div class="profile-name">${safeText(t.displayName)}</div><div class="tag">${safeText(t.tier)} tier · ${t.featured ? 'Featured trader' : 'Trader profile'}</div></div></div>
      <p class="tag profile-bio">${safeText(t.bio || 'No trader biography provided.')}</p>
      <div class="grid grid-3 profile-stats">
        <div><span class="tag">30d ROI</span><b class="${t.roi30d >= 0 ? 'positive' : 'negative'}">${t.roi30d >= 0 ? '+' : ''}${fmt(t.roi30d)}%</b></div>
        <div><span class="tag">Win rate</span><b>${fmt(t.winRate)}%</b></div>
        <div><span class="tag">Followers</span><b>${Number(t.followers || 0).toLocaleString()}</b></div>
        <div><span class="tag">Total trades</span><b>${Number(t.totalTrades || 0).toLocaleString()}</b></div>
        <div><span class="tag">Performance fee</span><b>${Number(t.performanceFee ?? 10)}%</b></div>
        <div><span class="tag">Total earned</span><b>${fmt(t.totalEarned)} USDT</b></div>
        <div><span class="tag">Risk score</span><b class="risk-${String(t.riskLevel || 'Medium').toLowerCase()}">${Number(t.riskScore || 0)}/10 · ${safeText(t.riskLevel || '—')}</b></div>
      </div>
      <div class="profile-chart-head"><div><h4>Performance history</h4><span class="tag">Daily 30-day ROI snapshots</span></div>
        <div class="profile-range"><button class="secondary sm active" data-days="30" onclick="loadTraderHistory(30)">30D</button><button class="secondary sm" data-days="90" onclick="loadTraderHistory(90)">90D</button><button class="secondary sm" data-days="180" onclick="loadTraderHistory(180)">180D</button></div></div>
      <div class="profile-chart-wrap"><canvas id="trader-history-chart" height="220"></canvas></div>
      <div class="tag profile-disclaimer">Past performance is not a guarantee of future results. Risk score (1–10) reflects volatility, drawdown and win rate. Copy trading involves risk, including loss of your allocation.</div>
      <button style="width:100%;margin-top:14px;" onclick="closeModal('trader-profile-modal');openFollow('${t._id}')">Copy this trader</button>`;
    await loadTraderHistory(30);
  } catch (e) { document.getElementById('trader-profile-body').innerHTML = `<div class="empty">${safeText(e.message)}</div>`; }
};

window.loadTraderHistory = async days => {
  if (!profileTraderId) return;
  profileHistoryDays = days;
  try {
    const data = await api(`/api/copy/${profileTraderId}/history?days=${days}`);
    document.querySelectorAll('.profile-range button').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
    drawTraderHistory(data.points || []);
  } catch (e) { toast(e.message, 'error'); }
};

function drawTraderHistory(points) {
  const canvas = document.getElementById('trader-history-chart'); if (!canvas) return;
  const width = Math.max(300, canvas.clientWidth || 600), height = 220, dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
  if (!points.length) { ctx.fillText('No performance history yet', 20, 35); return; }
  const values = points.map(p => Number(p.roi || 0));
  let min = Math.min(0, ...values), max = Math.max(0, ...values); if (max - min < 1) { max += 0.5; min -= 0.5; }
  const pad = { l: 42, r: 14, t: 16, b: 28 }, plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
  ctx.font = '11px system-ui'; ctx.strokeStyle = 'rgba(148,163,184,.2)'; ctx.fillStyle = 'rgba(148,163,184,.9)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = pad.t + plotH * i / 4; const v = max - (max - min) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke(); ctx.fillText(`${v.toFixed(1)}%`, 2, y + 4); }
  const xy = values.map((v, i) => ({ x: pad.l + (points.length === 1 ? 0 : plotW * i / (points.length - 1)), y: pad.t + (max - v) / (max - min) * plotH }));
  ctx.beginPath(); xy.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444'; ctx.lineWidth = 2.5; ctx.stroke();
  const first = new Date(points[0].date), last = new Date(points[points.length - 1].date);
  ctx.fillStyle = 'rgba(148,163,184,.9)'; ctx.fillText(first.toLocaleDateString(), pad.l, height - 7); const endLabel = last.toLocaleDateString(); ctx.fillText(endLabel, Math.max(pad.l, width - pad.r - ctx.measureText(endLabel).width), height - 7);
  ctx.fillStyle = values[values.length - 1] >= 0 ? '#22c55e' : '#ef4444'; const end = xy[xy.length - 1]; ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.fill();
}

window.openFollow = traderId => {
  const t = allTraders.find(x => x._id === traderId); if (!t) return;
  const perfFee = Number(t.performanceFee ?? 0);
  const platFee = Number(platformFeePercent ?? t.platformFee ?? 0);
  document.getElementById('follow-title').textContent = `Copy ${t.displayName}`;
  document.getElementById('follow-body').innerHTML = `
    <p class="tag" style="margin-bottom:14px;">Allocate USDT to copy ${safeText(t.displayName)}. You can stop copying at any time.</p>
    <div class="copy-fee-note">⚠️ Fees are charged on profits only: <b>${perfFee}% performance fee</b> (paid to the trader) and <b>${platFee}% platform fee</b>.</div>
    <div class="copy-balance"><span class="tag">Your balance</span><b>${userBalance.toFixed(2)} USDT</b></div>
    <label>Allocation (USDT)</label><input id="copy-amount" type="number" min="10" placeholder="100" />
    <p class="tag">Minimum 10 USDT</p><button id="copy-confirm-btn" style="width:100%" onclick="confirmFollow('${t._id}')">Start copying</button>`;
  openModal('follow-modal');
};

window.confirmFollow = async traderId => {
  const btn = document.getElementById('copy-confirm-btn');
  if (btn?.disabled) return;
  const amt = Number(document.getElementById('copy-amount').value);
  if (!amt || amt < 10) return toast('Minimum allocation is 10 USDT', 'warn');
  if (amt > userBalance) return toast('Insufficient USDT balance', 'warn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    await api(`/api/copy/follow/${traderId}`, { method: 'POST', body: JSON.stringify({ allocation: amt }) });
    closeModal('follow-modal'); toast('You are now copying this trader', 'success');
    await Promise.all([loadBalance(), loadMyCopies(), loadTraders()]);
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Start copying'; }
  }
};

let unfollowing = false;
window.unfollow = async relId => {
  if (unfollowing) return;
  const ok = await confirmAction({
    title: 'Stop copying this trader?',
    message: 'Your allocation and PnL, less any outstanding performance fees, will be returned to your wallet.',
    confirmText: 'Stop copying', danger: true
  });
  if (!ok) return;
  unfollowing = true;
  try {
    await api(`/api/copy/unfollow/${relId}`, { method: 'POST' });
    toast('Stopped copying', 'success');
    await Promise.all([loadBalance(), loadMyCopies()]);
  } catch (e) { toast(e.message, 'error'); }
  finally { unfollowing = false; }
};

/* ============ LEADERBOARD ============ */
async function loadLeaderboard() {
  const weekEl = document.getElementById('leaderboard-week'), topEl = document.getElementById('leaderboard-top');
  if (!weekEl || !topEl) return;
  try {
    const r = await api('/api/leaderboard/current'); weekEl.textContent = r.weekId;
    const medals = ['🥇', '🥈', '🥉'], top3 = r.entries.slice(0, 3), rest = r.entries.slice(3);
    setHTML(topEl, `<div class="grid grid-3" style="margin-bottom:14px;">${top3.map((t, i) => `<div class="leaderboard-top-item"><div style="font-size:32px;">${medals[i]}</div><div style="font-weight:700;">${safeText(t.displayName)}</div><div class="tag">${safeText(t.tier)}</div><div class="positive" style="font-weight:700;margin-top:6px;">${t.roi30d >= 0 ? '+' : ''}${fmt(t.roi30d)}%</div></div>`).join('')}</div>${rest.length ? `<div class="leaderboard-rest">${rest.map(t => `<div class="net-chip"><span class="positive">#${t.rank}</span> ${safeText(t.displayName)} <span class="tag">${t.roi30d >= 0 ? '+' : ''}${fmt(t.roi30d)}%</span></div>`).join('')}</div>` : ''}`);
  } catch (e) { console.warn('Leaderboard failed:', e.message); }
}
