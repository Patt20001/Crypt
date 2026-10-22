/* ============ CSV TEMPLATE DOWNLOAD ============ */
window.downloadCsvTemplate = () => {
  const template = `displayName,bio,tier,roi30d,winRate,followers,totalTrades,performanceFee,platformFee
Alpha Whale,Swing trader on BTC/ETH,diamond,42.5,71,1284,892,10,2
Steady Eddie,Conservative BTC accumulation,silver,12.1,78,312,445,8,1.5
Momentum Mike,Breakout scalper on SOL/BNB,gold,22.8,58,891,2104,12,2`;

  const blob = new Blob([template], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'copy-traders-template.csv';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof toast === 'function') toast('Template downloaded', 'success', 1500);
};

/* ============ CSV IMPORT ============ */
window.importTradersCsv = async () => {
  const fileInput = document.getElementById('csv-file');
  const resultEl = document.getElementById('csv-import-result');

  if (!fileInput?.files?.length) {
    if (resultEl) resultEl.innerHTML = '<p class="error">Please choose a CSV file first</p>';
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.endsWith('.csv')) {
    if (resultEl) resultEl.innerHTML = '<p class="error">File must be .csv</p>';
    return;
  }

  if (resultEl) resultEl.innerHTML = '<p class="tag">Uploading…</p>';

  const form = new FormData();
  form.append('file', file);

  try {
    const r = await fetch('/api/copy/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: form
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Import failed');

    let html = `<p class="success">✅ ${d.message} · Total traders: ${d.total}</p>`;
    if (d.errors && d.errors.length) {
      html += `<details style="margin-top: 10px;"><summary class="tag" style="cursor:pointer;">${d.errors.length} skipped row(s)</summary>
        <div style="margin-top: 8px; font-size: 12px; color: #fca5a5; font-family: monospace;">
          ${d.errors.map(e => `<div>${e}</div>`).join('')}
        </div>
      </details>`;
    }
    resultEl.innerHTML = html;
    toast(`Imported ${d.count} traders`, 'success');
    fileInput.value = '';
    if (typeof refreshAll === 'function') refreshAll();
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<p class="error">❌ ${e.message}</p>`;
    toast(e.message, 'error');
  }
};