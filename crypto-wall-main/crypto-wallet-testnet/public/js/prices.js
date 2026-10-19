const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true';

async function fetchPrices() {
  const res = await fetch(COINGECKO_URL);
  if (!res.ok) throw new Error('price fetch failed');
  return res.json();
}

function buildTicker(data) {
  const rows = [
    { sym: 'BTC', price: data.bitcoin?.usd, chg: data.bitcoin?.usd_24h_change },
    { sym: 'ETH', price: data.ethereum?.usd, chg: data.ethereum?.usd_24h_change },
    { sym: 'SOL', price: data.solana?.usd, chg: data.solana?.usd_24h_change }
  ];
  const wrap = document.createElement('div');
  wrap.className = 'ticker';
  wrap.innerHTML = rows.map(r => {
    if (r.price == null) return '';
    const cls = r.chg >= 0 ? 'up' : 'down';
    const arrow = r.chg >= 0 ? '▲' : '▼';
    return `
      <span class="ticker-item">
        <span class="ticker-sym">${r.sym}</span>
        <span class="ticker-price">$${r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span class="ticker-chg ${cls}">${arrow} ${Math.abs(r.chg).toFixed(2)}%</span>
      </span>`;
  }).join('');
  return wrap;
}

async function mountTicker() {
  const host = document.querySelector('.nav-links');
  if (!host) return;

  let ticker;
  try {
    ticker = buildTicker(await fetchPrices());
  } catch {
    ticker = document.createElement('div');
    ticker.className = 'ticker';
    ticker.innerHTML = `<span class="ticker-item tag">prices unavailable</span>`;
  }
  // Insert before the theme toggle
  const toggle = host.querySelector('.theme-toggle');
  if (toggle) host.insertBefore(ticker, toggle);
  else host.appendChild(ticker);

  // refresh every 60s
  setInterval(async () => {
    try {
      const fresh = buildTicker(await fetchPrices());
      ticker.replaceWith(fresh);
      ticker = fresh;
    } catch {}
  }, 60_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountTicker);
} else {
  mountTicker();
}