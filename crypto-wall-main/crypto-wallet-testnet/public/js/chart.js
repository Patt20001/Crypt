/* ============================================================
   NovaWallet — Live candlestick chart (Binance)
   Uses Lightweight Charts v5 + Binance public WebSocket
   ============================================================ */

let binanceWs = null;
let candleChart = null;
let candleSeries = null;
let currentSymbol = 'BTCUSDT';
let lastPriceUpdate = 0;

/* ---------------- HELPERS ---------------- */
function toBinanceSymbol(pair) {
  // 'BTC/USDT' -> 'btcusdt' (lowercase, no slash — what Binance WS expects)
  return pair.replace('/', '').toLowerCase();
}

/* ---------------- CHART INIT ---------------- */
function initCandleChart() {
  const container = document.getElementById('candle-chart');
  if (!container) {
    console.warn('candle-chart container not found');
    return false;
  }
  if (typeof LightweightCharts === 'undefined') {
    console.warn('Lightweight Charts library not loaded');
    container.innerHTML = '<div class="empty">Chart library failed to load</div>';
    return false;
  }

  // Destroy previous chart if it exists
  if (candleChart) {
    candleChart.remove();
    candleChart = null;
    candleSeries = null;
  }

  candleChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 380,
    layout: {
      background: { color: 'transparent' },
      textColor: '#94a3b8'
    },
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
  const symbol = toBinanceSymbol(pair).toUpperCase();

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`
    );
    if (!res.ok) {
      // HTTP 451 = geo-blocked
      if (res.status === 451) {
        throw new Error('Binance is blocked in your region (HTTP 451)');
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      throw new Error('No candle data returned');
    }

    const candles = data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4])
    }));

    if (candleSeries) {
      candleSeries.setData(candles);
      candleChart.timeScale().fitContent();
    }

    const latest = candles[candles.length - 1];
    if (latest) updatePriceDisplay(latest.close, pair);
  } catch (e) {
    console.error('Failed to load historical candles:', e);
    toast(`Chart error: ${e.message}`, 'warn', 5000);
  }
}

/* ---------------- LIVE STREAM ---------------- */
function startLiveStream(pair) {
  currentSymbol = toBinanceSymbol(pair);
  const bybitSymbol = pair.replace('/', '').toUpperCase(); // BTC/USDT -> BTCUSDT

  // Close any existing stream
  if (binanceWs) {
    try { binanceWs.close(); } catch {}
    binanceWs = null;
  }

  // ---- Try Binance WebSocket first ----
  const binanceUrl = `wss://stream.binance.com:9443/ws/${currentSymbol}@kline_1m`;
  let binanceFailed = false;

  binanceWs = new WebSocket(binanceUrl);

  binanceWs.onopen = () => {
    console.log('Binance WS connected for', currentSymbol);
  };

  binanceWs.onmessage = (event) => {
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
        updatePriceDisplay(candle.close, pair);
      }
    } catch (err) { /* ignore */ }
  };

  binanceWs.onerror = () => {
    // Don't show a toast — silently fall back to Bybit
    if (binanceFailed) return;
    binanceFailed = true;
    console.warn('Binance WS failed — falling back to Bybit');
    startBybitStream(bybitSymbol, pair);
  };

  binanceWs.onclose = () => {
    // Only fall back if we never got a successful message
    if (!binanceFailed && (!binanceWs || binanceWs.readyState === WebSocket.CLOSED)) {
      // Only fall back if we haven't already
      if (!window.__bybitWsActive) {
        binanceFailed = true;
        startBybitStream(bybitSymbol, pair);
      }
    }
  };
}

/* ============================================================
   Bybit WebSocket fallback
   ============================================================ */
function startBybitStream(symbol, pair) {
  if (binanceWs) {
    try { binanceWs.close(); } catch {}
    binanceWs = null;
  }

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  binanceWs = ws;
  window.__bybitWsActive = true;

  ws.onopen = () => {
    console.log('Bybit WS connected for', symbol);
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`kline.1.${symbol}`]
    }));
  };

  ws.onmessage = (event) => {
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
        updatePriceDisplay(candle.close, pair);
      }
    } catch (err) { /* ignore */ }
  };

  ws.onerror = () => {
    console.warn('Bybit WS also failed — chart will show historical only');
  };

  ws.onclose = () => {
    window.__bybitWsActive = false;
    console.log('Bybit WS closed');
  };
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
    window.__bybitWsActive = false;
  initCandleChart();
  await loadHistoricalCandles(pair);
  startLiveStream(pair);
};

window.switchTradePair = async function (pair) {
    window.__bybitWsActive = false;
  if (!candleChart) {
    await window.initTradeChart(pair);
    return;
  }
  await loadHistoricalCandles(pair);
  startLiveStream(pair);
};