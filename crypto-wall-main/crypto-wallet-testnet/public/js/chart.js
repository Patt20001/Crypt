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
let currentInterval = '1m';
const BYBIT_INTERVALS = { '1m':'1', '5m':'5', '15m':'15', '1h':'60', '4h':'240', '1d':'D' };


// Increments on every pair switch. Any WS/interval that doesn't
// match this value is stale and must not touch the chart.
let chartStreamGen = 0;
let simulatedStreamHandle = null;

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
  const myGen = chartStreamGen;
  const container = document.getElementById('candle-chart');
  const status = document.getElementById('chart-status');
  if (status) status.textContent = 'Loading candles…';

  try {
    // Same-origin authenticated endpoint avoids browser CORS failures and
    // supplies simulated development candles when external feeds are down.
    const data = await api(`/api/orders/candles/${encodeURIComponent(pair.replace('/', '-'))}?interval=${encodeURIComponent(currentInterval)}`);
    if (myGen !== chartStreamGen) return;
    const candles = Array.isArray(data.candles) ? data.candles : [];
    if (!candles.length) throw new Error('The candle endpoint returned no data');
    if (candleSeries) {
      candleSeries.setData(candles);
      candleChart.timeScale().fitContent();
    }
    const latest = candles[candles.length - 1];
    updatePriceDisplay(latest.close, pair);
    if (status) status.textContent = data.source === 'simulated-development' ? 'Simulated chart data · development mode' : 'Market reference candles';
    return;
  } catch (e) {
    console.warn('Server candle request failed; using browser-side demo candles:', e.message);
  }

  // Last-resort client fallback keeps the chart visible if the server candle
  // endpoint is temporarily unavailable during local development.
  if (myGen !== chartStreamGen) return;
  const seconds = ({ '1m':60, '5m':300, '15m':900, '1h':3600, '4h':14400, '1d':86400 })[currentInterval] || 60;
  let price = Number(window.__livePrice) || 68000;
  const now = Math.floor(Date.now() / (seconds * 1000)) * seconds;
  const candles = [];
  for (let i = 149; i >= 0; i--) {
    const open = price;
    const close = Math.max(0.00000001, open * (1 + (Math.random() - 0.5) * 0.008));
    const wick = Math.max(open, close) * (0.0002 + Math.random() * 0.001);
    candles.push({ time: now - i * seconds, open, high: Math.max(open, close) + wick, low: Math.max(0.00000001, Math.min(open, close) - wick), close });
    price = close;
  }
  if (candleSeries) {
    candleSeries.setData(candles);
    candleChart.timeScale().fitContent();
  }
  updatePriceDisplay(candles[candles.length - 1].close, pair);
  if (status) status.textContent = 'Local simulated candles · server feed unavailable';
}

/* ---------------- LIVE STREAM ---------------- */
async function startLiveStream(pair) {
  // Bump generation — any previous stream is now stale
  chartStreamGen++;
  const myGen = chartStreamGen;
  if (simulatedStreamHandle) { clearInterval(simulatedStreamHandle); simulatedStreamHandle = null; }

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
  const url = `wss://stream.binance.com:9443/ws/${currentSymbol}@kline_${currentInterval}`;
  let failed = false;
  let ws;
  try { ws = new WebSocket(url); } catch (e) { console.warn('Binance WebSocket unavailable:', e.message); startSimulatedStream(myGen); return; }
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
    if (myGen !== chartStreamGen) return;
    if (failed) return;
    failed = true;
    console.warn('Binance WS failed — trying Bybit');
    startBybitStream(myGen);
  };
  ws.onclose = () => {
    if (myGen === chartStreamGen && !failed) startBybitStream(myGen);
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

  let ws;
  try { ws = new WebSocket('wss://stream.bybit.com/v5/public/spot'); }
  catch (e) { console.warn('Bybit WebSocket unavailable:', e.message); startSimulatedStream(myGen); return; }
  binanceWs = ws;

  ws.onopen = () => {
    console.log('Bybit WS connected for', currentBybitSymbol);
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`kline.${BYBIT_INTERVALS[currentInterval]}.${currentBybitSymbol}`]
    }));
  };

  ws.onmessage = (event) => {
    if (myGen !== chartStreamGen) return;   // stale → ignore
    try {
      const data = JSON.parse(event.data);
      if (!data.topic || !data.topic.startsWith(`kline.${BYBIT_INTERVALS[currentInterval]}.`)) return;
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
    console.warn('Bybit WS failed — using simulated chart updates');
    startSimulatedStream(myGen);
  };
  ws.onclose = () => {
    if (myGen === chartStreamGen) startSimulatedStream(myGen);
  };
}

function startSimulatedStream(myGen) {
  if (myGen !== chartStreamGen) return;
  if (simulatedStreamHandle) clearInterval(simulatedStreamHandle);
  console.warn('Running simulated drift (no exchange reachable)');
  let price = window.__livePrice || 68000;

  simulatedStreamHandle = setInterval(() => {
    if (myGen !== chartStreamGen) {
      clearInterval(simulatedStreamHandle);   // stop when pair switches
      simulatedStreamHandle = null;
      return;
    }
    price = price * (1 + (Math.random() - 0.5) * 0.0005);
    const seconds = ({'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400})[currentInterval] || 60;
    const bucket = Math.floor(Math.floor(Date.now() / 1000) / seconds) * seconds;

    if (candleSeries) {
      candleSeries.update({ time: bucket, open: price, high: price, low: price, close: price });
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

window.setTradeChartInterval = async function (interval) {
  if (!BYBIT_INTERVALS[interval]) return;
  currentInterval = interval;
  if (candleChart) {
    await loadHistoricalCandles(currentPairForLabel);
    await startLiveStream(currentPairForLabel);
  }
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