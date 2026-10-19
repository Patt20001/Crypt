const user = requireAuth();
if (user) document.addEventListener('DOMContentLoaded', load);

async function load() {
  const el = document.getElementById('ref-content');
  el.innerHTML = '<div class="skeleton skeleton-card"></div>';
  try {
    const r = await api('/api/referrals');
    el.innerHTML = `
      <div class="card">
        <h3>Your referral code</h3>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:8px;">
          <div class="ref-code">${r.code}</div>
          <button class="secondary sm" onclick="copyCode('${r.code}')">Copy code</button>
          <button class="secondary sm" onclick="copyCode('${r.link}')">Copy link</button>
        </div>
        <p class="tag" style="margin-top:10px;">Share this code with friends. You earn 5 USDT when they make their first deposit.</p>
      </div>

      <div class="grid grid-3">
        <div class="card"><h3>Invites</h3><div class="balance">${r.invites}</div></div>
        <div class="card"><h3>Total earned</h3><div class="balance">${r.totalEarned.toFixed(2)}</div></div>
        <div class="card"><h3>Per referral</h3><div class="balance">5.00</div></div>
      </div>

      <div class="card">
        <h3>Referral history</h3>
        ${r.history.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>User</th><th>Joined</th><th>Status</th></tr></thead>
            <tbody>${r.history.map(h => `
              <tr>
                <td>${h.referee?.username || '-'}</td>
                <td>${h.referee?.createdAt ? new Date(h.referee.createdAt).toLocaleDateString() : '-'}</td>
                <td>${h.bonusPaid
                  ? '<span class="badge completed">paid</span>'
                  : '<span class="badge pending">pending first deposit</span>'}</td>
              </tr>`).join('')}
            </tbody></table></div>` : '<div class="empty">No referrals yet</div>'}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

window.copyCode = (text) => {
  navigator.clipboard.writeText(text);
  toast('Copied to clipboard', 'success', 1500);
};