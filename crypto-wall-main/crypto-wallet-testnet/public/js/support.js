function supportEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function loadSupportTickets() {
  const el = document.getElementById('support-ticket-list'); if (!el) return;
  if (!el.dataset.loaded) el.innerHTML = skeletonRows(2);
  try {
    const tickets = await api('/api/support');
    el.dataset.loaded = '1';
    if (!tickets.length) { el.innerHTML = emptyState('💬', 'No support requests yet', 'When you contact support, your conversations will appear here.'); return; }
    el.innerHTML = tickets.map(t => `<div class="card" style="margin:10px 0;padding:14px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><b>${supportEscape(t.subject)}</b><span class="badge ${t.status === 'closed' ? 'rejected' : 'pending'}">${supportEscape(t.status.replace('_',' '))}</span></div>
      <div class="tag">${supportEscape(t.category)} · Updated ${new Date(t.updatedAt).toLocaleString()}</div>
      ${(t.messages || []).map(m => `<div style="padding:10px;margin-top:8px;border-radius:8px;background:var(--surface-2,rgba(127,127,127,.08));"><b>${m.sender === 'admin' ? 'NovaWallet Support' : 'You'}</b><p style="white-space:pre-wrap;margin:6px 0 0;">${supportEscape(m.body)}</p></div>`).join('')}
      ${t.status !== 'closed' ? `<div style="display:flex;gap:8px;margin-top:10px;"><input id="reply-${t._id}" placeholder="Write a reply" maxlength="5000" style="margin:0;flex:1;"><button class="secondary sm" onclick="replySupportTicket('${t._id}')">Reply</button></div>` : ''}
    </div>`).join('');
  } catch (e) { el.innerHTML = emptyState('⚠️', 'Could not load support requests', e.message || 'Please try again.'); }
}
window.submitSupportTicket = async () => {
  const subject = document.getElementById('support-subject').value.trim();
  const message = document.getElementById('support-message').value.trim();
  const category = document.getElementById('support-category').value;
  const feedback = document.getElementById('support-feedback');
  try {
    await api('/api/support', { method:'POST', body:JSON.stringify({ subject, message, category }) });
    document.getElementById('support-subject').value = ''; document.getElementById('support-message').value = '';
    feedback.textContent = 'Your support request has been submitted.'; await loadSupportTickets();
  } catch (e) { feedback.textContent = e.message; }
};
window.replySupportTicket = async id => {
  const input = document.getElementById(`reply-${id}`); const message = input?.value.trim(); if (!message) return;
  try { await api(`/api/support/${id}/reply`, { method:'POST', body:JSON.stringify({ message }) }); await loadSupportTickets(); }
  catch (e) { toast(e.message, 'error'); }
};
document.addEventListener('DOMContentLoaded', loadSupportTickets);
