/* ============================================================
   NovaWallet — Notification Bell
   The bell itself is rendered by ui.js (inside the nav).
   This file only fetches data and wires clicks.
   ============================================================ */

let pollHandle = null;

/* ---------------- FETCH & RENDER ---------------- */
async function refreshNotifications() {
  const bell = document.querySelector('.notif-bell');
  const panel = document.querySelector('.notif-panel');
  // The nav might not be rendered yet on first tick — retry next cycle
  if (!bell || !panel) return;

  try {
    const r = await api('/api/notifications');
    renderBell(r.unread);
    renderDropdown(r.list);
  } catch (e) {
    // silent — page might not be authenticated yet or on a public page
  }
}

function renderBell(unread) {
  const bell = document.querySelector('.notif-bell');
  if (!bell) return;
  const badge = bell.querySelector('.notif-badge');
  if (!badge) return;

  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = 'grid';
  } else {
    badge.style.display = 'none';
  }
}

function renderDropdown(list) {
  const panel = document.querySelector('.notif-panel');
  if (!panel) return;

  if (!list.length) {
    panel.innerHTML = '<div class="empty" style="padding:20px;">No notifications</div>';
    return;
  }

  const icons = {
    deposit:  '↓',
    withdraw: '↑',
    stake:    '📈',
    kyc:      '🛡️',
    security: '🔒',
    referral: '🎁',
    system:   'ℹ️'
  };

  panel.innerHTML = `
    <div class="notif-head">
      <span>Notifications</span>
      <button class="secondary sm" onclick="markAllRead()">Mark all read</button>
    </div>
    <div class="notif-list">
      ${list.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead('${n._id}')">
          <div class="notif-icon">${icons[n.type] || 'ℹ️'}</div>
          <div style="flex:1; min-width:0;">
            <div class="notif-title">${n.title}</div>
            ${n.body ? `<div class="notif-body">${n.body}</div>` : ''}
            <div class="notif-time">${timeAgo(n.createdAt)}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ---------------- ACTIONS ---------------- */
window.markRead = async (id) => {
  try {
    await api(`/api/notifications/${id}/read`, { method: 'POST' });
    refreshNotifications();
  } catch {}
};

window.markAllRead = async () => {
  try {
    await api('/api/notifications/read-all', { method: 'POST' });
    refreshNotifications();
  } catch {}
};

/* ---------------- HELPERS ---------------- */
function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/* ---------------- BELL TOGGLE ---------------- */
// The bell element is created by ui.js — we just need one global handler
// that works regardless of when the bell appears in the DOM.
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-notif-toggle]');
  if (toggle) {
    e.stopPropagation();
    const panel = toggle.parentElement.querySelector('.notif-panel');
    if (panel) panel.classList.toggle('open');
    return;
  }
  // Close the panel when clicking anywhere else
  if (!e.target.closest('.notif-panel')) {
    document.querySelectorAll('.notif-panel.open').forEach(p => p.classList.remove('open'));
  }
});

/* ---------------- POLLING ---------------- */
function initNotifications() {
  if (!localStorage.getItem('token')) return;

  // Wait for ui.js to finish rendering the nav, then start
  setTimeout(() => {
    refreshNotifications();
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(refreshNotifications, 20_000);
  }, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNotifications);
} else {
  initNotifications();
}