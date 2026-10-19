const _user = requireAuth();
if (_user) {
  document.addEventListener('DOMContentLoaded', init);
}

async function init() {
  const u = await api('/api/auth/me').then(r => r.user);
  document.getElementById('avatar').textContent = u.username[0].toUpperCase();
  document.getElementById('uname').textContent = u.username;
  document.getElementById('email').textContent = u.email;
  document.getElementById('displayName').value = u.displayName || '';
  document.getElementById('country').value = u.country || '';
  document.getElementById('addr').textContent = u.walletAddress;

  renderKyc(u);
  renderDocs(u.kycDocuments || []);

  const sw = document.getElementById('twofa');
  if (u.twoFA) sw.classList.add('on');

  sw.addEventListener('click', () => {
    if (sw.classList.contains('on')) {
      disable2FA();
    } else {
      start2FASetup();
    }
  });

  // render recovery codes button if enabled
  if (u.twoFA) renderRecoverySection();

  setupUploader();
}

function renderKyc(u) {
  const pill = document.getElementById('kyc');
  pill.textContent = `KYC: ${u.kycStatus[0].toUpperCase() + u.kycStatus.slice(1)}`;
  pill.className = `kyc-pill kyc-${u.kycStatus}`;

  const banner = document.getElementById('kyc-status-banner');
  if (u.kycStatus === 'verified') {
    banner.innerHTML = '<div class="broadcast" style="--broadcast-icon: none;">✅ Your identity has been verified. Unlimited withdrawals enabled.</div>';
  } else if (u.kycStatus === 'pending') {
    banner.innerHTML = '<div class="broadcast">⏳ Documents under review. This usually takes a few minutes.</div>';
  } else {
    banner.innerHTML = '<div class="broadcast">🔓 Complete verification to unlock higher withdrawal limits.</div>';
  }
}

function setupUploader() {
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('kyc-file');

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) uploadFile(input.files[0]); });

  // drag & drop
  ['dragover','dragenter'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragging'); }));
  ['dragleave','drop'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragging'); }));
  zone.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  });
}

function uploadFile(file) {
  const allowed = ['.jpg','.jpeg','.png','.webp','.pdf'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) return toast('Only JPG, PNG, WEBP, or PDF allowed', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('File must be under 5MB', 'error');

  const progWrap = document.getElementById('upload-progress');
  const progBar = document.getElementById('upload-progress-bar');
  progWrap.style.display = 'block';
  progBar.style.width = '0%';

  const form = new FormData();
  form.append('document', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload/kyc');
  xhr.setRequestHeader('Authorization', `Bearer ${token()}`);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total) * 100;
      progBar.style.width = pct + '%';
    }
  };

  xhr.onload = async () => {
    progWrap.style.display = 'none';
    if (xhr.status >= 200 && xhr.status < 300) {
      toast('Document uploaded — under review', 'success');
      const u = await api('/api/auth/me').then(r => r.user);
      renderKyc(u);
      renderDocs(u.kycDocuments || []);
    } else {
      let err = 'Upload failed';
      try { err = JSON.parse(xhr.responseText).error || err; } catch {}
      toast(err, 'error');
    }
  };

  xhr.onerror = () => {
    progWrap.style.display = 'none';
    toast('Upload failed', 'error');
  };

  xhr.send(form);
}

function renderDocs(docs) {
  const el = document.getElementById('docs');
  if (!docs.length) {
    el.innerHTML = '<div class="empty">No documents uploaded yet</div>';
    return;
  }
  el.innerHTML = `
    <div class="grid grid-2">
      ${docs.map(d => `
        <div class="doc-card">
          ${d.mimetype.startsWith('image/')
            ? `<img src="${d.url}" alt="doc" class="doc-thumb" />`
            : `<div class="doc-thumb doc-file">📄<div class="tag">${d.filename.split('.').pop().toUpperCase()}</div></div>`}
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:13px; word-break:break-all;">${d.filename}</div>
            <div class="tag">${(d.size/1024).toFixed(0)} KB · ${new Date(d.uploadedAt).toLocaleDateString()}</div>
          </div>
          <button class="danger sm" onclick="removeDoc('${d.filename}')">Remove</button>
        </div>`).join('')}
    </div>`;
}

window.removeDoc = async (filename) => {
  if (!confirm('Remove this document?')) return;
  try {
    await api(`/api/upload/kyc/${filename}`, { method: 'DELETE' });
    toast('Document removed', 'success');
    const u = await api('/api/auth/me').then(r => r.user);
    renderDocs(u.kycDocuments || []);
    renderKyc(u);
  } catch (e) { toast(e.message, 'error'); }
};

/* ============ Existing profile actions ============ */
window.saveProfile = async () => {
  try {
    const displayName = document.getElementById('displayName').value;
    const country = document.getElementById('country').value;
    await api('/api/profile/update', { method: 'PUT', body: JSON.stringify({ displayName, country }) });
    toast('Profile updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

window.rotate = async () => {
  if (!confirm('Rotate your wallet address? Old addresses will no longer be accepted.')) return;
  try {
    const r = await api('/api/profile/rotate-address', { method: 'POST' });
    document.getElementById('addr').textContent = r.walletAddress;
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    stored.walletAddress = r.walletAddress;
    localStorage.setItem('user', JSON.stringify(stored));
    toast('Wallet address rotated', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

window.togglePwd = () => {
  const f = document.getElementById('pwd-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
};

window.changePwd = async () => {
  const current = document.getElementById('cur-pwd').value;
  const next = document.getElementById('new-pwd').value;
  try {
    await api('/api/profile/password', { method: 'PUT', body: JSON.stringify({ current, next }) });
    toast('Password updated', 'success');
    document.getElementById('cur-pwd').value = '';
    document.getElementById('new-pwd').value = '';
    togglePwd();
  } catch (e) { toast(e.message, 'error'); }
};

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

// Close modal when clicking the dark backdrop (not the inner card)
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  }
});

/* ============================================================
   2FA SETUP — STEP 1: Show QR
   ============================================================ */
async function start2FASetup() {
  try {
    const setup = await api('/api/auth/2fa/setup', { method: 'POST' });
    const body = document.getElementById('twofa-modal-body');
    document.getElementById('twofa-modal-title').textContent = 'Set up Two-Factor Authentication';

    body.innerHTML = `
      <p class="tag" style="margin-bottom: 16px; line-height: 1.6;">
        Scan this QR code with <b>Google Authenticator</b>, <b>Authy</b>, or <b>1Password</b>.
        Then enter the 6-digit code your app shows.
      </p>

      <div style="display:flex; justify-content:center; margin-bottom: 16px;">
        <div id="qr-2fa" style="padding: 14px; background:#fff; border-radius: 14px;"></div>
      </div>

      <details style="margin-bottom: 18px;">
        <summary class="tag" style="cursor:pointer; padding: 8px 0;">
          Can't scan? Enter the setup key manually
        </summary>
        <div style="
          margin-top: 8px;
          padding: 12px 14px;
          background: rgba(148,163,184,.08);
          border: 1px solid var(--border);
          border-radius: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          word-break: break-all;
          color: var(--text-dim);
          letter-spacing: 1px;
        ">${setup.secret}</div>
      </details>

      <label>Enter the 6-digit code</label>
      <input id="twofa-code-input" maxlength="7" placeholder="123 456" autocomplete="one-time-code"
        style="text-align:center; font-family: monospace; font-size: 22px; letter-spacing: 8px; padding: 14px;" />

      <div id="twofa-setup-msg" style="min-height: 18px; margin-bottom: 10px;"></div>

      <button style="width:100%" onclick="confirmEnable2FA()">Verify & Enable</button>
    `;

    openModal('twofa-modal');

    // Render QR
    const qrHost = document.getElementById('qr-2fa');
    if (window.QRCode) {
      new QRCode(qrHost, {
        text: setup.otpauth,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrHost.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.otpauth)}" alt="QR" />`;
    }

    setTimeout(() => document.getElementById('twofa-code-input')?.focus(), 150);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ============================================================
   2FA SETUP — STEP 2: Confirm code
   ============================================================ */
window.confirmEnable2FA = async () => {
  const input = document.getElementById('twofa-code-input');
  const msg = document.getElementById('twofa-setup-msg');
  const code = input.value.trim();

  if (!code) {
    msg.className = 'error';
    msg.textContent = 'Please enter the code';
    input.focus();
    return;
  }

  msg.className = '';
  msg.textContent = 'Verifying…';

  try {
    const r = await api('/api/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code })
    });

    // Show recovery codes
    document.getElementById('twofa-modal-title').textContent = 'Save your recovery codes';
    document.getElementById('twofa-modal-body').innerHTML = `
      <div style="
        padding: 14px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(74,222,128,.14), rgba(34,211,238,.08));
        border: 1px solid rgba(74,222,128,.3);
        text-align: center;
        font-weight: 600;
        margin-bottom: 18px;
      ">
        ✅ 2FA enabled successfully
      </div>

      <p class="tag" style="margin-bottom: 14px; line-height: 1.6;">
        <b style="color: var(--text);">Save these recovery codes.</b>
        Each can be used once to log in if you lose access to your authenticator app.
        Store them somewhere safe — you won't see them again.
      </p>

      <div style="
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 16px;
        background: rgba(6,9,21,.5);
        border: 1px solid var(--border);
        border-radius: 12px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        margin-bottom: 14px;
        letter-spacing: 1px;
      ">
        ${r.recoveryCodes.map(c => `<div style="text-align:center;">${c}</div>`).join('')}
      </div>

      <button class="secondary" style="width:100%; margin-bottom: 10px;"
        onclick='copyRecoveryCodes(${JSON.stringify(r.recoveryCodes)})'>
        📋 Copy all codes
      </button>

      <button class="secondary" style="width:100%; margin-bottom: 10px;"
        onclick='downloadRecoveryCodes(${JSON.stringify(r.recoveryCodes)})'>
        💾 Download as .txt
      </button>

      <button style="width:100%" onclick="finish2FASetup()">
        I've saved my codes
      </button>
    `;

    // update toggle & local user
    document.getElementById('twofa').classList.add('on');
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    stored.twoFA = true;
    localStorage.setItem('user', JSON.stringify(stored));

    toast('2FA enabled', 'success');
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};

window.finish2FASetup = () => {
  closeModal('twofa-modal');
  location.reload();
};

window.copyRecoveryCodes = (codes) => {
  navigator.clipboard.writeText(codes.join('\n'));
  toast('Recovery codes copied', 'success', 1500);
};

window.downloadRecoveryCodes = (codes) => {
  const text = `NovaWallet — 2FA Recovery Codes\nGenerated: ${new Date().toLocaleString()}\n\n` +
    codes.join('\n') +
    `\n\nEach code can be used once. Keep this file offline and secure.`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'novawallet-recovery-codes.txt';
  a.click();
  URL.revokeObjectURL(url);
  toast('Recovery codes downloaded', 'success', 1500);
};

/* ============================================================
   2FA DISABLE — modal flow
   ============================================================ */
function disable2FA() {
  // reset form
  document.getElementById('disable-pwd').value = '';
  document.getElementById('disable-code').value = '';
  document.getElementById('disable-msg').textContent = '';
  openModal('disable-modal');
  setTimeout(() => document.getElementById('disable-pwd').focus(), 150);
}

window.confirmDisable2FA = async () => {
  const password = document.getElementById('disable-pwd').value;
  const code = document.getElementById('disable-code').value.trim();
  const msg = document.getElementById('disable-msg');
  const btn = document.querySelector('#disable-modal button.danger');

  if (!password) {
    msg.className = 'error';
    msg.textContent = 'Enter your password';
    return;
  }
  if (!code) {
    msg.className = 'error';
    msg.textContent = 'Enter the 6-digit code';
    return;
  }

  msg.className = '';
  msg.textContent = 'Verifying…';
  btn.disabled = true;
  btn.textContent = 'Disabling…';

  try {
    await api('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password, code })
    });

    // success
    document.getElementById('twofa').classList.remove('on');
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    stored.twoFA = false;
    localStorage.setItem('user', JSON.stringify(stored));

    closeModal('disable-modal');
    toast('2FA has been disabled', 'success');
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Disable 2FA';
  }
};

/* ============================================================
   REGENERATE RECOVERY CODES — modal prompt
   ============================================================ */
function renderRecoverySection() {
  const kycActions = document.getElementById('kyc-actions');
  if (!kycActions) return;
  if (document.getElementById('regen-2fa-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'regen-2fa-btn';
  btn.className = 'secondary sm';
  btn.textContent = 'Regenerate recovery codes';
  btn.style.marginTop = '12px';
  btn.onclick = openRegenerateModal;
  kycActions.parentNode.insertBefore(btn, kycActions.nextSibling);
}

function openRegenerateModal() {
  // Reuse the disable modal structure by injecting fresh content
  const modal = document.getElementById('disable-modal');
  const inner = modal.querySelector('.modal-inner');

  inner.innerHTML = `
    <div class="modal-head">
      <h3>Regenerate recovery codes</h3>
      <button class="modal-close" onclick="closeModal('disable-modal')">×</button>
    </div>

    <p class="tag" style="margin-bottom: 14px; line-height: 1.6;">
      This will invalidate your old codes and generate 8 new ones.
      Enter the current code from your authenticator app to continue.
    </p>

    <label>Authenticator code</label>
    <input id="regen-code" maxlength="7" placeholder="123 456"
      style="text-align:center; font-family: monospace; font-size: 20px; letter-spacing: 6px;" />

    <div id="regen-msg" style="min-height: 18px; margin-bottom: 10px;"></div>

    <button style="width:100%" onclick="confirmRegenerate()">Generate new codes</button>
  `;

  openModal('disable-modal');
  setTimeout(() => document.getElementById('regen-code').focus(), 150);
}

window.confirmRegenerate = async () => {
  const code = document.getElementById('regen-code').value.trim();
  const msg = document.getElementById('regen-msg');
  if (!code) { msg.className = 'error'; msg.textContent = 'Enter the code'; return; }

  msg.className = '';
  msg.textContent = 'Verifying…';

  try {
    const r = await api('/api/auth/2fa/recovery-codes', {
      method: 'POST',
      body: JSON.stringify({ code })
    });

    // Replace modal body with new codes
    const inner = document.querySelector('#disable-modal .modal-inner');
    inner.innerHTML = `
      <div class="modal-head">
        <h3>New recovery codes</h3>
        <button class="modal-close" onclick="closeModal('disable-modal'); location.reload();">×</button>
      </div>

      <div style="
        padding: 12px;
        border-radius: 10px;
        background: linear-gradient(135deg, rgba(74,222,128,.14), rgba(34,211,238,.08));
        border: 1px solid rgba(74,222,128,.3);
        text-align: center;
        font-weight: 600;
        margin-bottom: 16px;
      ">
        ✅ New codes generated — save them now
      </div>

      <div style="
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        padding: 16px; background: rgba(6,9,21,.5);
        border: 1px solid var(--border); border-radius: 12px;
        font-family: monospace; font-size: 13px; margin-bottom: 14px;
        letter-spacing: 1px;
      ">
        ${r.recoveryCodes.map(c => `<div style="text-align:center;">${c}</div>`).join('')}
      </div>

      <button class="secondary" style="width:100%; margin-bottom: 10px;"
        onclick='copyRecoveryCodes(${JSON.stringify(r.recoveryCodes)})'>
        📋 Copy all codes
      </button>

      <button class="secondary" style="width:100%; margin-bottom: 10px;"
        onclick='downloadRecoveryCodes(${JSON.stringify(r.recoveryCodes)})'>
        💾 Download as .txt
      </button>

      <button style="width:100%" onclick="closeModal('disable-modal'); location.reload();">
        Done
      </button>
    `;
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};
