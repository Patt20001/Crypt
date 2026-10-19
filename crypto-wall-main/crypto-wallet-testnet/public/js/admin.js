const user = requireAuth(true);

if (user) {
  document.addEventListener('DOMContentLoaded', refreshAll);
}

async function refreshAll() {
  await Promise.all([
    loadStats(),
    loadPending(),
    loadUsers(),
    loadKycQueue(),
    loadStakes(),
    loadAllTxs(),
    loadBanner(),
    loadMaintenance()
  ]);
}

/* ============ STATS ============ */
async function loadStats() {
  const el = document.getElementById('stats');
  el.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(3);
  try {
    const s = await api('/api/admin/stats');
    el.innerHTML = `
      <div class="card"><h3>Total Users</h3><div class="balance">${s.users}</div></div>
      <div class="card"><h3>Pending Txs</h3><div class="balance" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);-webkit-background-clip:text;background-clip:text;color:transparent;">${s.pending}</div></div>
      <div class="card"><h3>Pending KYC</h3><div class="balance" style="background:linear-gradient(135deg,#a855f7,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent;">${s.pendingKyc || 0}</div></div>
      <div class="card"><h3>Total Staked</h3><div class="balance">${(s.totalStaked || 0).toFixed(2)}</div></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ PENDING TXS (inline amount entry) ============ */
async function loadPending() {
  const el = document.getElementById('pending');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(2);
  try {
    const txs = await api('/api/admin/transactions');
    const pending = txs.filter(t => t.status === 'pending');

    if (!pending.length) {
      el.innerHTML = '<div class="empty">No pending transactions</div>';
      return;
    }

    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead>
          <tr>
            <th>User</th>
            <th>Type</th>
            <th>Currency</th>
            <th>Amount</th>
            <th>Details</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pending.map(t => {
            const isDeposit = t.type === 'deposit';
            const amountCell = isDeposit
              ? `<input
                   type="number"
                   step="0.01"
                   min="0"
                   class="inline-amount"
                   id="amt-${t._id}"
                   placeholder="0.00"
                 />`
              : `<span class="locked-amount" id="amt-${t._id}" data-value="${t.amount}">
                   ${t.amount.toFixed(2)}
                 </span>`;

            const rejectBox = `
              <input
                type="text"
                class="inline-reason"
                id="reason-${t._id}"
                placeholder="Reject reason (optional)"
                style="display:none; width: 160px; margin: 6px 0 0 0; font-size: 12px; padding: 6px 8px;"
              />`;

            return `
              <tr data-txid="${t._id}">
                <td>${t.user?.username || '-'}</td>
                <td style="text-transform: capitalize;">${t.type}</td>
                <td>${t.currency}</td>
                <td>
                  ${amountCell}
                  ${rejectBox}
                </td>
                <td class="tag">${t.address || t.note || '-'}</td>
                <td>
                  <div style="display:flex; gap:6px; align-items:center;">
                    <button class="sm" title="Approve"
                      onclick="approveTx('${t._id}','${t.type}')">✓ Approve</button>
                    <button class="danger sm" title="Reject"
                      onclick="toggleReject('${t._id}')">✕ Reject</button>
                    <button class="danger sm" id="confirm-reject-${t._id}"
                      style="display:none;"
                      onclick="confirmReject('${t._id}')">Confirm</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ APPROVE / REJECT ============ */
window.approveTx = async (id, type) => {
  try {
    const payload = {};

    if (type === 'deposit') {
      const input = document.getElementById(`amt-${id}`);
      const amt = Number(input.value);
      if (!amt || amt <= 0) {
        input.style.borderColor = 'var(--danger)';
        input.style.boxShadow = '0 0 0 4px rgba(239,68,68,.12)';
        input.focus();
        toast('Enter the amount received before approving', 'warn');
        return;
      }
      payload.amount = amt;
    }

    await api(`/api/admin/transactions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    toast('Transaction approved', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

window.toggleReject = (id) => {
  const reasonInput = document.getElementById(`reason-${id}`);
  const confirmBtn = document.getElementById(`confirm-reject-${id}`);
  const visible = reasonInput.style.display === 'block';
  reasonInput.style.display = visible ? 'none' : 'block';
  confirmBtn.style.display = visible ? 'none' : 'inline-flex';
  if (!visible) reasonInput.focus();
};

window.confirmReject = async (id) => {
  try {
    const reason = document.getElementById(`reason-${id}`).value.trim();
    const payload = {};
    if (reason) payload.note = `Rejected: ${reason}`;

    await api(`/api/admin/transactions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    toast('Transaction rejected', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

/* ============ USERS ============ */
async function loadUsers() {
  const el = document.getElementById('users');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const users = await api('/api/admin/users');
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Username</th><th>Email</th><th>USDT</th><th>Role</th><th>KYC</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${u.username}</td>
            <td class="tag">${u.email}</td>
            <td style="font-weight: 600;">${u.balances.USDT.toFixed(2)}</td>
            <td>${u.role}</td>
            <td><span class="badge ${
              u.kycStatus === 'verified' ? 'completed'
              : u.kycStatus === 'pending' ? 'pending'
              : 'rejected'
            }">${u.kycStatus}</span></td>
            <td>${u.isBanned ? '<span class="badge rejected">banned</span>' : '<span class="badge completed">active</span>'}</td>
            <td style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="secondary sm" onclick="credit('${u._id}')">+10 USDT</button>
              <button class="secondary sm" onclick="kyc('${u._id}')">Set KYC</button>
              <button class="${u.isBanned ? 'secondary' : 'danger'} sm" onclick="ban('${u._id}')">${u.isBanned ? 'Unban' : 'Ban'}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ KYC QUEUE ============ */
async function loadKycQueue() {
  const el = document.getElementById('kyc-queue');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(2);
  try {
    const users = await api('/api/admin/users');
    const pending = users.filter(u => u.kycStatus === 'pending');
    if (!pending.length) {
      el.innerHTML = '<div class="empty">No KYC submissions awaiting review</div>';
      return;
    }
    el.innerHTML = pending.map(u => `
      <div class="card" style="margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom: 12px;">
          <div>
            <div style="font-weight:700;">${u.username}</div>
            <div class="tag">${u.email}</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="sm" onclick="approveKyc('${u._id}')">Verify</button>
            <button class="danger sm" onclick="rejectKyc('${u._id}')">Reject</button>
          </div>
        </div>
        <div class="grid grid-2">
          ${(u.kycDocuments || []).map(d => `
            <div class="doc-card">
              ${d.mimetype.startsWith('image/')
                ? `<a href="${d.url}" target="_blank"><img src="${d.url}" class="doc-thumb" /></a>`
                : `<a href="${d.url}" target="_blank" class="doc-thumb doc-file">📄<div class="tag">${d.filename.split('.').pop().toUpperCase()}</div></a>`}
              <div style="flex:1; min-width:0;">
                <div style="font-size:12px; word-break:break-all;">${d.filename}</div>
                <div class="tag">${(d.size/1024).toFixed(0)} KB</div>
              </div>
            </div>`).join('') || '<div class="empty">No documents</div>'}
        </div>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ STAKES ============ */
async function loadStakes() {
  const el = document.getElementById('stakes');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const stakes = await api('/api/admin/stakes');
    if (!stakes.length) { el.innerHTML = '<div class="empty">No stakes yet</div>'; return; }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>APY</th><th>Accrued</th><th>Status</th></tr></thead>
        <tbody>${stakes.map(s => `
          <tr>
            <td>${s.user?.username || '-'}</td>
            <td>${s.plan.toUpperCase()}</td>
            <td style="font-weight: 600;">${s.amount.toFixed(2)}</td>
            <td>${s.apy}%</td>
            <td style="color: var(--accent); font-weight: 600;">+${s.accrued.toFixed(4)}</td>
            <td><span class="badge ${s.status === 'active' ? 'completed' : 'rejected'}">${s.status}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ ALL TRANSACTIONS ============ */
async function loadAllTxs() {
  const el = document.getElementById('alltx');
  el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
  try {
    const txs = await api('/api/admin/transactions');
    if (!txs.length) { el.innerHTML = '<div class="empty">No transactions</div>'; return; }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>User</th><th>Type</th><th>Currency</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${txs.slice(0, 50).map(t => `
          <tr>
            <td>${new Date(t.createdAt).toLocaleString()}</td>
            <td>${t.user?.username || '-'}</td>
            <td style="text-transform: capitalize;">${t.type}</td>
            <td>${t.currency}</td>
            <td style="font-weight: 600;">${t.amount}</td>
            <td><span class="badge ${t.status}">${t.status}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

/* ============ BANNER ============ */
async function loadBanner() {
  try {
    const s = await api('/api/settings');
    if (s.banner) {
      document.getElementById('banner-msg').value = s.banner.message || '';
      document.getElementById('banner-active').checked = !!s.banner.active;
    }
  } catch {}
}

/* ============ OTHER USER ACTIONS ============ */
window.ban = async (id) => {
  try {
    await api(`/api/admin/users/${id}/ban`, { method: 'POST' });
    toast('User status updated', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

/* ============ MAINTENANCE MODE ============ */
async function loadMaintenance() {
  try {
    const s = await api('/api/settings');
    const sw = document.getElementById('maintenance-switch');
    const msg = document.getElementById('maintenance-msg');
    if (!sw) return;
    if (s.maintenance) {
      if (s.maintenance.active) sw.classList.add('on');
      msg.value = s.maintenance.message || '';
    }
    sw.onclick = async () => {
      sw.classList.toggle('on');
      await api('/api/admin/maintenance', {
        method: 'POST',
        body: JSON.stringify({
          active: sw.classList.contains('on'),
          message: msg.value || undefined
        })
      });
      toast(`Maintenance ${sw.classList.contains('on') ? 'enabled' : 'disabled'}`, 'success');
    };
  } catch {}
}

window.credit = async (id) => {
  try {
    await api(`/api/admin/users/${id}/balance`, {
      method: 'POST',
      body: JSON.stringify({ currency: 'USDT', amount: 10 })
    });
    toast('+10 USDT credited', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

window.kyc = async (id) => {
  const status = prompt('Set KYC status: unverified / pending / verified', 'verified');
  if (!status) return;
  try {
    await api(`/api/admin/users/${id}/kyc`, { method: 'POST', body: JSON.stringify({ status }) });
    toast('KYC updated', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

window.approveKyc = async (id) => {
  try {
    await api(`/api/admin/users/${id}/kyc`, { method: 'POST', body: JSON.stringify({ status: 'verified' }) });
    toast('User verified', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

window.rejectKyc = async (id) => {
  try {
    await api(`/api/admin/users/${id}/kyc`, { method: 'POST', body: JSON.stringify({ status: 'unverified' }) });
    toast('KYC rejected', 'success');
    refreshAll();
  } catch (e) { toast(e.message, 'error'); }
};

window.saveBanner = async () => {
  const message = document.getElementById('banner-msg').value;
  const active = document.getElementById('banner-active').checked;
  try {
    await api('/api/admin/banner', { method: 'POST', body: JSON.stringify({ message, active }) });
    toast('Banner updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
};