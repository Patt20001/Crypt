/* ============================================================
   NovaWallet — Live candlestick chart (v5 API)
   Uses Lightweight Charts v5 (self-hosted) + exchange WebSocket
   Pair-switching safe: generation counter kills stale streams
   No globals clash with orders.js
   ============================================================ */

let binanceWs = null;
let candleChart = null;
let candleSeries = null;
let currentSymbol = 'btcusdt';
let currentBybitSymbol = 'BTCUSDT';
let currentPairForLabel = 'BTC/USDT';
let lastPriceUpdate = 0;

// Increments on every pair switch. Any WS/interval that doesn't
// match this value is stale and must not touch the chart.
let chartStreamGen = 0;

/* ---------------- HELPERS ---------------- */
function toBinanceSymbol(pair) {
  return pair.replace('/', '').toLowerCase();     // BTC/USDT -> btcusdt
}
function toBybitSymbol(pair) {
  return pair.replace('/', '').toUpperCase();     // BTC/USDT -> BTCUSDT
}

/* ---------------- CHART INIT (v5 API) ---------------- */
function initCandleChart() {
  const container = document.getElementById('candle-chart');
  if (!container) {
    console.warn('candle-chart container not found');
    return false;
  }
  if (typeof LightweightCharts === 'undefined') {
    console.warn('Lightweight Charts not loaded — check /js/lightweight-charts.js');
    container.innerHTML = '<div class="empty" style="padding:20px;">Chart library not loaded</div>';
    return false;
  }

  if (candleChart) {
    candleChart.remove();
    candleChart = null;
    candleSeries = null;
  }

  candleChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 380,
    layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
    grid: {
      vertLines: { color: 'rgba(148,163,184,0.08)' },
      horzLines: { color: 'rgba(148,163,184,0.08)' }
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
    timeScale: {
      borderColor: 'rgba(148,163,184,0.2)',
      timeVisible: true,
      secondsVisible: false
    }
  });

  candleSeries = candleChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#4ade80',
    downColor: '#ef4444',
    borderUpColor: '#4ade80',
    borderDownColor: '#ef4444',
    wickUpColor: '#4ade80',
    wickDownColor: '#ef4444'
  });

  window.addEventListener('resize', () => {
    if (candleChart && container) {
      candleChart.applyOptions({ width: container.clientWidth });
    }
  });

  return true;
}

/* ---------------- HISTORICAL CANDLES ---------------- */
async function loadHistoricalCandles(pair) {
  const symbol = pair.replace('/', '').toUpperCase();
  const myGen = chartStreamGen;   // capture generation at call time

  const attempts = [
    {
      name: 'binance',
      url: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`,
      parse: (data) => data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4])
      }))
    },
    {
      name: 'bybit',
      url: `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=100`,
      parse: (json) => {
        if (json.retCode !== 0) throw new Error(json.retMsg);
        return json.result.list.slice().reverse().map(k => ({
          time: Math.floor(parseInt(k[0]) / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4])
        }));
      }
    }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const raw = await res.json();
      const candles = attempt.parse(raw);
      if (!candles || !candles.length) continue;

      // Guard: user may have switched while we were fetching
      if (myGen !== chartStreamGen) {
        console.log(`Discarding stale candles for ${pair}`);
        return;
      }

      if (candleSeries) {
        candleSeries.setData(candles);
        candleChart.timeScale().fitContent();
      }
      const latest = candles[candles.length - 1];
      if (latest) updatePriceDisplay(latest.close, pair);

      console.log(`Candles loaded from ${attempt.name} for ${pair}`);
      return;
    } catch (e) {
      console.warn(`${attempt.name} candles failed:`, e.message);
    }
  }

  console.error('All candle sources failed');
  toast('Chart data unavailable', 'warn', 3000);
}

/* ---------------- LIVE STREAM ---------------- */
async function startLiveStream(pair) {
  // Bump generation — any previous stream is now stale
  chartStreamGen++;
  const myGen = chartStreamGen;

  currentSymbol = toBinanceSymbol(pair);
  currentBybitSymbol = toBybitSymbol(pair);
  currentPairForLabel = pair;

  // Close existing socket & null its handlers (prevents stray callbacks)
  if (binanceWs) {
    try {
      binanceWs.onopen = null;
      binanceWs.onmessage = null;
      binanceWs.onerror = null;
      binanceWs.onclose = null;
      binanceWs.close();
    } catch {}
    binanceWs = null;
  }

  // Ask server which exchange works
  let exchange = 'binance';
  try {
    const h = await fetch('/api/orders/health').then(r => r.json());
    exchange = h.exchange || 'binance';
  } catch (e) {
    console.warn('Health check failed, defaulting to binance');
  }

  // Guard: user may have switched while we waited for health
  if (myGen !== chartStreamGen) {
    console.log('Aborting stale stream start');
    return;
  }

  console.log(`Live stream via: ${exchange} for ${pair}`);

  if (exchange === 'bybit' || exchange === 'coingecko') {
    startBybitStream(myGen);
  } else if (exchange === 'fallback') {
    startSimulatedStream(myGen);
  } else {
    startBinanceStream(myGen);
  }
}

function startBinanceStream(myGen) {
  const url = `wss://stream.binance.com:9443/ws/${currentSymbol}@kline_1m`;
  let failed = false;
  const ws = new WebSocket(url);
  binanceWs = ws;

  ws.onopen = () => console.log('Binance WS connected');

  ws.onmessage = (event) => {
    if (myGen !== chartStreamGen) return;   // stale → ignore
    try {
      const data = JSON.parse(event.data);
      if (!data.k) return;
      if (data.k.s !== currentSymbol.toUpperCase()) return;

      const candle = {
        time: Math.floor(data.k.t / 1000),
        open: parseFloat(data.k.o),
        high: parseFloat(data.k.h),
        low: parseFloat(data.k.l),
        close: parseFloat(data.k.c)
      };
      if (candleSeries) candleSeries.update(candle);

      const now = Date.now();
      if (now - lastPriceUpdate > 500) {
        lastPriceUpdate = now;
        updatePriceDisplay(candle.close, currentPairForLabel);
      }
    } catch {}
  };

  ws.onerror = () => {
    if (myGen !== chartStreamGen) return;   // stale → don't fall back
    if (failed) return;
    failed = true;
    console.warn('Binance WS failed — trying Bybit');
    startBybitStream(myGen);
  };
}

function startBybitStream(myGen) {
  if (binanceWs) {
    try {
      binanceWs.onopen = null;
      binanceWs.onmessage = null;
      binanceWs.onerror = null;
      binanceWs.onclose = null;
      binanceWs.close();
    } catch {}
    binanceWs = null;
  }

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  binanceWs = ws;

  ws.onopen = () => {
    console.log('Bybit WS connected for', currentBybitSymbol);
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`kline.1.${currentBybitSymbol}`]
    }));
  };

  ws.onmessage = (event) => {
    if (myGen !== chartStreamGen) return;   // stale → ignore
    try {
      const data = JSON.parse(event.data);
      if (!data.topic || !data.topic.startsWith('kline.')) return;
      if (!data.data || !data.data[0]) return;

      const k = data.data[0];
      const candle = {
        time: Math.floor(parseInt(k.start) / 1000),
        open: parseFloat(k.open),
        high: parseFloat(k.high),
        low: parseFloat(k.low),
        close: parseFloat(k.close)
      };
      if (candleSeries) candleSeries.update(candle);

      const now = Date.now();
      if (now - lastPriceUpdate > 500) {
        lastPriceUpdate = now;
        updatePriceDisplay(candle.close, currentPairForLabel);
      }
    } catch {}
  };

  ws.onerror = () => {
    if (myGen !== chartStreamGen) return;
    console.warn('Bybit WS failed');
  };
}

function startSimulatedStream(myGen) {
  console.warn('Running simulated drift (no exchange reachable)');
  let price = window.__livePrice || 68000;

  const handle = setInterval(() => {
    if (myGen !== chartStreamGen) {
      clearInterval(handle);   // stop when pair switches
      return;
    }
    price = price * (1 + (Math.random() - 0.5) * 0.0005);
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / 60) * 60;

    if (candleSeries) {
      candleSeries.update({
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price
      });
    }
    updatePriceDisplay(price, currentPairForLabel);
  }, 3000);
}

/* ---------------- PRICE DISPLAY ---------------- */
function updatePriceDisplay(price, pair) {
  const priceEl = document.getElementById('pair-price');
  if (priceEl) {
    priceEl.textContent = `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  const labelEl = document.getElementById('chart-pair-label');
  if (labelEl) labelEl.textContent = `· ${pair}`;

  window.__livePrice = price;
  window.__livePair = pair;
}

/* ---------------- PUBLIC API ---------------- */
window.initTradeChart = async function (pair) {
  currentPairForLabel = pair;
  initCandleChart();
  await loadHistoricalCandles(pair);
  await startLiveStream(pair);
};

window.switchTradePair = async function (pair) {
  currentPairForLabel = pair;
  if (!candleChart) {
    await window.initTradeChart(pair);
    return;
  }
  await loadHistoricalCandles(pair);
  await startLiveStream(pair);
};