function adminEscape(v) { return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function loadAdminSupport(page=1) {
  const el=document.getElementById('admin-support'); if(!el)return; el.innerHTML='<div class="skeleton skeleton-row"></div>'.repeat(2);
  try {
    const status=document.getElementById('support-filter')?.value||'';
    const d=await api(`/api/admin/support?page=${page}&limit=10${status?`&status=${encodeURIComponent(status)}`:''}`);
    if(!d.items.length){el.innerHTML='<div class="empty">No support tickets found.</div>';return;}
    el.innerHTML=d.items.map(t=>`<div class="card" style="margin:10px 0;padding:14px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div><b>${adminEscape(t.subject)}</b><div class="tag">${adminEscape(t.user?.username)} · ${adminEscape(t.user?.email)} · ${adminEscape(t.category)}</div></div><span class="badge pending">${adminEscape(t.status)}</span></div>
      ${(t.messages||[]).map(m=>`<div style="padding:9px;margin-top:8px;border-radius:8px;background:var(--surface-2,rgba(127,127,127,.08));"><b>${m.sender==='admin'?'Admin':'User'}</b><div style="white-space:pre-wrap;margin-top:5px;">${adminEscape(m.body)}</div></div>`).join('')}
      <div class="grid grid-2" style="margin-top:10px;"><div><label>Reply</label><textarea id="admin-reply-${t._id}" rows="2" placeholder="Write a response"></textarea><button class="sm" onclick="replyAdminTicket('${t._id}')">Send reply</button></div><div><label>Status</label><select id="admin-ticket-status-${t._id}"><option value="open" ${t.status==='open'?'selected':''}>Open</option><option value="in_progress" ${t.status==='in_progress'?'selected':''}>In progress</option><option value="waiting_user" ${t.status==='waiting_user'?'selected':''}>Waiting for user</option><option value="closed" ${t.status==='closed'?'selected':''}>Closed</option></select><label>Priority</label><select id="admin-ticket-priority-${t._id}"><option value="low">Low</option><option value="normal" ${t.priority==='normal'?'selected':''}>Normal</option><option value="high" ${t.priority==='high'?'selected':''}>High</option><option value="urgent" ${t.priority==='urgent'?'selected':''}>Urgent</option></select><button class="secondary sm" onclick="updateAdminTicket('${t._id}')">Save ticket</button></div></div>
    </div>`).join('')+`<div class="tag">${d.total} tickets · Page ${d.page}/${Math.max(1,d.pages)}</div><div style="display:flex;gap:8px;margin-top:8px;"><button class="secondary sm" ${page<=1?'disabled':''} onclick="loadAdminSupport(${page-1})">Previous</button><button class="secondary sm" ${page>=d.pages?'disabled':''} onclick="loadAdminSupport(${page+1})">Next</button></div>`;
  }catch(e){el.innerHTML=`<div class="empty">${adminEscape(e.message)}</div>`;}
}
window.replyAdminTicket=async id=>{const message=document.getElementById(`admin-reply-${id}`).value.trim();if(!message)return;try{await api(`/api/admin/support/${id}/reply`,{method:'POST',body:JSON.stringify({message})});toast('Reply sent','success');loadAdminSupport();}catch(e){toast(e.message,'error');}};
window.updateAdminTicket=async id=>{try{await api(`/api/admin/support/${id}`,{method:'PATCH',body:JSON.stringify({status:document.getElementById(`admin-ticket-status-${id}`).value,priority:document.getElementById(`admin-ticket-priority-${id}`).value})});toast('Ticket updated','success');loadAdminSupport();}catch(e){toast(e.message,'error');}};
let adminTradingEnabled=true;
async function loadTradingControls(){
  try{const d=await api('/api/admin/controls');adminTradingEnabled=d.trading?.enabled!==false;const sw=document.getElementById('trading-enabled-switch');sw?.classList.toggle('on',adminTradingEnabled);document.getElementById('trading-pause-message').value=d.trading?.message||'';
    const pairs=['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT','ADA/USDT','DOGE/USDT','LTC/USDT','TRX/USDT','DOT/USDT','AVAX/USDT','LINK/USDT','BCH/USDT','TON/USDT','NEAR/USDT','ATOM/USDT','UNI/USDT'];
    document.getElementById('pair-controls').innerHTML=pairs.map(pair=>{const enabled=d.pairs?.[pair]?.enabled!==false;return `<div class="row"><div class="row-label">${pair}</div><button class="${enabled?'secondary':'danger'} sm" onclick="setPairEnabled('${pair}',${!enabled})">${enabled?'Enabled':'Disabled'} · Change</button></div>`}).join('');
  }catch(e){toast(e.message,'error');}
}
window.saveTradingSettings=async()=>{try{const d=await api('/api/admin/controls/trading',{method:'POST',body:JSON.stringify({enabled:adminTradingEnabled,message:document.getElementById('trading-pause-message').value})});toast('Trading settings saved','success');}catch(e){toast(e.message,'error');}};
window.toggleTradingEngine=async()=>{try{adminTradingEnabled=!adminTradingEnabled;const d=await api('/api/admin/controls/trading',{method:'POST',body:JSON.stringify({enabled:adminTradingEnabled,message:document.getElementById('trading-pause-message').value})});document.getElementById('trading-enabled-switch').classList.toggle('on',d.enabled);toast(d.enabled?'Trading enabled':'New trading orders paused','success');}catch(e){adminTradingEnabled=!adminTradingEnabled;toast(e.message,'error');}};
window.setPairEnabled=async(pair,enabled)=>{try{await api('/api/admin/controls/pair',{method:'POST',body:JSON.stringify({pair,enabled})});loadTradingControls();}catch(e){toast(e.message,'error');}};
async function loadAdminPositions(page=1){
  const el=document.getElementById('admin-positions');if(!el)return;
  el.innerHTML='<div class="skeleton skeleton-row"></div>'.repeat(2);
  try{
    const d=await api(`/api/admin/positions?page=${page}&limit=15`);
    if(!d.items.length){el.innerHTML='<div class="empty">No open positions.</div>';return;}
    el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>User</th><th>Pair</th><th>Amount</th><th>Entry price (editable)</th><th>Stop loss</th><th>Take profit</th><th>Close at price</th><th>Actions</th></tr></thead><tbody>${d.items.map(p=>`<tr><td>${adminEscape(p.user?.username)}</td><td>${adminEscape(p.pair)}</td><td>${p.amount}</td><td><input id="entry-${p._id}" type="number" min="0.00000001" step="any" value="${p.avgCost}" style="width:110px" oninput="previewAdminClose('${p._id}',${p.amount})"></td><td><input id="sl-${p._id}" type="number" min="0" step="any" value="${p.stopLoss||0}" style="width:90px"></td><td><input id="tp-${p._id}" type="number" min="0" step="any" value="${p.takeProfit||0}" style="width:90px"></td><td><input id="close-${p._id}" type="number" min="0.00000001" step="any" placeholder="Set close price" style="width:120px" oninput="previewAdminClose('${p._id}',${p.amount},${p.avgCost})"><div id="close-preview-${p._id}" class="tag">Enter price for P/L</div></td><td><button class="secondary sm" onclick="saveAdminPosition('${p._id}')">Save edits</button> <button class="danger sm" onclick="closeAdminPosition('${p._id}')">Close at set price</button></td></tr>`).join('')}</tbody></table></div><div class="tag" style="margin-top:8px;">${d.total} open positions · Page ${d.page}/${Math.max(1,d.pages)}. Entry edits change the position’s P/L cost basis only; they do not rewrite past wallet transactions.</div><div style="display:flex;gap:8px;margin-top:8px;"><button class="secondary sm" ${page<=1?'disabled':''} onclick="loadAdminPositions(${page-1})">Previous</button><button class="secondary sm" ${page>=d.pages?'disabled':''} onclick="loadAdminPositions(${page+1})">Next</button></div>`;
  }catch(e){el.innerHTML=`<div class="empty">${adminEscape(e.message)}</div>`;}
}
window.previewAdminClose=(id,amount)=>{
  const price=Number(document.getElementById(`close-${id}`)?.value);
  const entry=Number(document.getElementById(`entry-${id}`)?.value);
  const el=document.getElementById(`close-preview-${id}`);if(!el)return;
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(entry)||entry<=0){el.textContent='Enter entry and close prices';return;}
  const pnl=(price-entry)*amount;
  el.textContent=`Estimated ${pnl>=0?'profit':'loss'}: ${pnl>=0?'+':''}${pnl.toFixed(6)} USDT`;
  el.style.color=pnl>=0?'var(--accent)':'#fca5a5';
};
window.saveAdminPosition=async id=>{
  const entry=Number(document.getElementById(`entry-${id}`).value);
  const sl=Number(document.getElementById(`sl-${id}`).value);
  const tp=Number(document.getElementById(`tp-${id}`).value);
  try{
    await api(`/api/admin/positions/${id}`,{method:'PATCH',body:JSON.stringify({avgCost:entry,stopLoss:sl,takeProfit:tp})});
    toast('Position entry and protection updated','success');loadAdminPositions();
  }catch(e){toast(e.message,'error');}
};
window.closeAdminPosition=async id=>{
  const closePrice=Number(document.getElementById(`close-${id}`).value);
  if(!Number.isFinite(closePrice)||closePrice<=0)return toast('Enter a valid close price','warn');
  if(!confirm(`Close this position at ${closePrice}? The user's asset balance will be sold at this entered price and realized P/L will be recorded.`))return;
  try{
    const r=await api(`/api/admin/positions/${id}/close`,{method:'POST',body:JSON.stringify({closePrice})});
    toast(`Position closed · P/L ${Number(r.pnl||0).toFixed(6)} ${r.quote}`,'success');loadAdminPositions();
  }catch(e){toast(e.message,'error');}
};
window.loadDatabaseHealth=async()=>{const el=document.getElementById('database-health');el.textContent='Checking database…';try{const d=await api('/api/admin/database/health');el.innerHTML=`<div class="grid grid-3"><div class="card"><b>Connection</b><div>${d.ping?'Healthy':'Unavailable'}</div></div><div class="card"><b>Database</b><div>${adminEscape(d.name)}</div></div><div class="card"><b>MongoDB</b><div>${adminEscape(d.serverVersion)}</div></div></div><div class="table-wrap"><table><thead><tr><th>Collection</th><th>Documents</th></tr></thead><tbody>${d.collections.map(c=>`<tr><td>${adminEscape(c.name)}</td><td>${c.count}</td></tr>`).join('')}</tbody></table></div>`;}catch(e){el.textContent=e.message;}};
window.exportDatabase=async()=>{if(!confirm('Export a logical JSON backup of wallet and trading records? Sensitive authentication secrets are excluded.'))return;try{const data=await api('/api/admin/database/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`novawallet-export-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('Export prepared','success');}catch(e){toast(e.message,'error');}};
async function refreshAdminTools(){await Promise.all([loadAdminSupport(),loadTradingControls(),loadAdminPositions()]);}
document.addEventListener('DOMContentLoaded',()=>{refreshAdminTools();});


/* ============ ADMIN USER DEPOSIT ADDRESSES ============ */
window.editUserWalletAddresses = async userId => {
  const title = document.getElementById('user-wallet-address-title');
  const fields = document.getElementById('user-wallet-address-fields');
  if (!fields) return;
  fields.innerHTML = '<div class="skeleton skeleton-row"></div>';
  openModal('user-wallet-address-modal');
  try {
    const data = await api(`/api/admin/users/${userId}/wallet-addresses`);
    title.textContent = `Deposit addresses · ${adminEscape(data.username)}`;
    const addresses = data.depositAddresses || {};
    fields.innerHTML = ['TRC20','ERC20','BEP20'].map(network => `
      <div style="margin-bottom:14px;">
        <label>${network} deposit address</label>
        <input id="admin-wallet-${network}" type="text" autocomplete="off" spellcheck="false"
          value="${adminEscape(addresses[network] || '')}" placeholder="Paste ${network} address" />
      </div>`).join('') + `
      <div class="tag" style="margin-bottom:12px;">Network-specific address formats are validated before saving. Addresses cannot be cleared here.</div>
      <div id="admin-wallet-address-feedback" class="tag" style="margin-bottom:10px;"></div>
      <button style="width:100%;" onclick="saveUserWalletAddresses('${userId}')">Save wallet addresses</button>`;
  } catch (e) {
    fields.innerHTML = `<div class="empty">${adminEscape(e.message)}</div>`;
  }
};

window.saveUserWalletAddresses = async userId => {
  const feedback = document.getElementById('admin-wallet-address-feedback');
  try {
    const addresses = {};
    for (const network of ['TRC20','ERC20','BEP20']) {
      const input = document.getElementById(`admin-wallet-${network}`);
      const value = input.value.trim();
      if (value !== input.defaultValue) addresses[network] = value;
    }
    if (!Object.keys(addresses).length) {
      toast('No address changes to save', 'warn');
      return;
    }
    await api(`/api/admin/users/${userId}/wallet-addresses`, {
      method: 'PATCH',
      body: JSON.stringify({ addresses })
    });
    toast('User deposit addresses updated', 'success');
    closeModal('user-wallet-address-modal');
  } catch (e) {
    if (feedback) feedback.textContent = e.message;
    toast(e.message, 'error');
  }
};
