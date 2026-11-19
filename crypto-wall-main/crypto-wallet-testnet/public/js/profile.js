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

  if (u.twoFA) renderRecoverySection();

  setupUploader();

  // ============ NEW LINES ============
  document.getElementById('firstName').value = u.firstName || '';
  document.getElementById('lastName').value = u.lastName || '';
  if (u.dateOfBirth) {
    document.getElementById('dateOfBirth').value = new Date(u.dateOfBirth).toISOString().split('T')[0];
  }

  loadSecurityQuestionStatus();
  renderSelfie(u.kycSelfie);
  setupSelfieUploader();
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
    await api('/api/profile/update', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: document.getElementById('displayName').value,
        country: document.getElementById('country').value,
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        dateOfBirth: document.getElementById('dateOfBirth').value || null
      })
    });
    toast('Profile updated', 'success');
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

let availableQuestions = [];

async function loadSecurityQuestionStatus() {
  try {
    const r = await api('/api/profile/security-questions');
    const el = document.getElementById('sq-status');
    if (r.hasQuestions) {
      el.textContent = `Set on ${new Date(r.setAt).toLocaleDateString()}`;
      el.style.color = 'var(--accent)';
    } else {
      el.textContent = 'Not set — required for password recovery';
      el.style.color = '#fbbf24';
    }
  } catch {}
}

window.openSecurityQuestions = async () => {
  try {
    if (!availableQuestions.length) {
      availableQuestions = await api('/api/profile/security-questions/available');
    }

    const existing = await api('/api/profile/security-questions');

    document.getElementById('sq-modal-body').innerHTML = `
      <p class="tag" style="margin-bottom: 14px;">
        Choose 3 questions. You'll need to answer these to reset your password if you forget it.
      </p>
      ${[0, 1, 2].map(i => `
        <div style="margin-bottom: 16px;">
          <label>Question ${i + 1}</label>
          <select id="sq-q-${i}" style="margin-bottom: 8px;">
            <option value="">— Select a question —</option>
            ${availableQuestions.map(q => `
              <option value="${q}" ${existing.questions?.[i] === q ? 'selected' : ''}>${q}</option>
            `).join('')}
          </select>
          <input id="sq-a-${i}" placeholder="Your answer (case-insensitive)" />
        </div>
      `).join('')}
      <label>Confirm your password</label>
      <input id="sq-pwd" type="password" placeholder="Enter account password" />
      <div id="sq-msg" style="min-height: 18px; margin-bottom: 10px;"></div>
      <button style="width:100%" onclick="saveSecurityQuestions()">Save questions</button>
    `;

    openModal('sq-modal');
  } catch (e) { toast(e.message, 'error'); }
};

window.saveSecurityQuestions = async () => {
  const pwd = document.getElementById('sq-pwd').value;
  const questions = [0, 1, 2].map(i => ({
    question: document.getElementById(`sq-q-${i}`).value,
    answer: document.getElementById(`sq-a-${i}`).value
  }));
  const msg = document.getElementById('sq-msg');

  if (!pwd) { msg.className = 'error'; msg.textContent = 'Password required'; return; }
  for (let i = 0; i < 3; i++) {
    if (!questions[i].question || !questions[i].answer) {
      msg.className = 'error'; msg.textContent = `Question ${i + 1} is incomplete`; return;
    }
  }

  try {
    await api('/api/profile/security-questions', {
      method: 'POST',
      body: JSON.stringify({ password: pwd, questions })
    });
    closeModal('sq-modal');
    toast('Security questions saved', 'success');
    loadSecurityQuestionStatus();
  } catch (e) {
    msg.className = 'error';
    msg.textContent = e.message;
  }
};

/* ============================================================
   SELFIE UPLOADER — with camera capture on mobile + desktop
   ============================================================ */
// Store camera permission state so we don't spam prompts
let cameraBlocked = false;

function setupSelfieUploader() {
  const zone = document.getElementById('selfie-zone');
  const input = document.getElementById('selfie-file');
  if (!zone || !input) return;

  zone.addEventListener('click', () => openSelfieCamera());

  input.addEventListener('change', () => {
    if (input.files[0]) uploadSelfieFile(input.files[0]);
  });
}

async function openSelfieCamera() {
  // If we already know camera is blocked, go straight to file picker
  if (cameraBlocked) {
    toast('Camera not available — opening file picker', 'info', 2000);
    document.getElementById('selfie-file')?.click();
    return;
  }

  const modal = document.getElementById('selfie-camera-modal');
  const video = document.getElementById('selfie-video');
  if (!modal || !video) return;

  // Check permission state first if supported
  try {
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: 'camera' });
      if (status.state === 'denied') {
        cameraBlocked = true;
        toast('Camera blocked. Enable it in browser settings or upload a photo.', 'warn', 4000);
        document.getElementById('selfie-file')?.click();
        return;
      }
    }
  } catch {
    // permissions API not available on this browser — continue
  }

  try {
    selfieStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = selfieStream;
    modal.classList.add('open');
  } catch (e) {
    console.warn('Camera error:', e.name, e.message);

    // Remember the failure so we don't prompt again
    cameraBlocked = true;

    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      toast('Camera permission denied. Upload a photo instead.', 'warn', 4000);
    } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      toast('No camera found. Upload a photo instead.', 'warn', 4000);
    } else if (e.name === 'NotReadableError') {
      toast('Camera is busy. Close other apps and try again, or upload a photo.', 'warn', 4000);
    } else {
      toast('Camera unavailable. Upload a photo instead.', 'warn', 3000);
    }

    // Fall back to file picker once
    document.getElementById('selfie-file')?.click();
  }
}

window.closeSelfieCamera = function () {
  const modal = document.getElementById('selfie-camera-modal');
  if (modal) modal.classList.remove('open');
  if (selfieStream) {
    selfieStream.getTracks().forEach(t => t.stop());
    selfieStream = null;
  }
};

window.captureSelfie = function () {
  const video = document.getElementById('selfie-video');
  if (!video || !selfieStream) return;

  // Draw video frame to canvas
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Convert to blob and upload
  canvas.toBlob(blob => {
    if (!blob) return toast('Failed to capture image', 'error');
    const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
    uploadSelfieFile(file);
    closeSelfieCamera();
  }, 'image/jpeg', 0.9);
};

function uploadSelfieFile(file) {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) return toast('Only JPG, PNG, or WEBP', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('Max 5MB', 'error');

  const form = new FormData();
  form.append('selfie', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload/selfie');
  xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);

  const zone = document.getElementById('selfie-zone');
  if (zone) zone.style.opacity = '0.5';

  xhr.onload = async () => {
    if (zone) zone.style.opacity = '1';
    if (xhr.status >= 200 && xhr.status < 300) {
      toast('Selfie uploaded', 'success');
      const u = await api('/api/auth/me').then(r => r.user);
      renderSelfie(u.kycSelfie);
      renderKyc(u);
    } else {
      let err = 'Upload failed';
      try { err = JSON.parse(xhr.responseText).error || err; } catch {}
      toast(err, 'error');
    }
  };

  xhr.onerror = () => {
    if (zone) zone.style.opacity = '1';
    toast('Upload failed', 'error');
  };

  xhr.send(form);
}

// keep existing renderSelfie() and removeSelfie() unchanged

function renderSelfie(selfie) {
  const el = document.getElementById('selfie-preview');
  if (!el) return;
  if (!selfie?.url) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
      <img src="${selfie.url}" alt="Selfie" style="width: 80px; height: 80px; border-radius: 10px; object-fit: cover;" />
      <div style="flex:1;">
        <div style="font-weight: 600;">Selfie uploaded</div>
        <div class="tag">${new Date(selfie.uploadedAt).toLocaleString()}</div>
      </div>
      <button class="danger sm" onclick="removeSelfie()">Remove</button>
    </div>
  `;
}

window.removeSelfie = async () => {
  if (!confirm('Remove this selfie?')) return;
  try {
    await api('/api/upload/selfie', { method: 'DELETE' });
    toast('Selfie removed', 'success');
    renderSelfie(null);
  } catch (e) { toast(e.message, 'error'); }
};
