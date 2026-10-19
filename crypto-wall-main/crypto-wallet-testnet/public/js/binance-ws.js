// public/js/binance-ws.js
let binanceWs = null;
let currentBinancePair = 'btcusdt';

window.connectBinance = function(pair = 'btcusdt', onMessage) {
  if (binanceWs) binanceWs.close();
  
  currentBinancePair = pair.toLowerCase();
  const url = `wss://stream.binance.com:9443/ws/${currentBinancePair}@kline_1m`;
  
  binanceWs = new WebSocket(url);
  
  binanceWs.onopen = () => {
    console.log('Binance WebSocket connected:', currentBinancePair);
  };
  
  binanceWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.k) {
      onMessage({
        time: Math.floor(data.k.t / 1000),
        open: parseFloat(data.k.o),
        high: parseFloat(data.k.h),
        low: parseFloat(data.k.l),
        close: parseFloat(data.k.c),
        volume: parseFloat(data.k.v),
        isClosed: data.k.x
      });
    }
  };
  
  binanceWs.onerror = (err) => console.error('Binance WS error:', err);
  binanceWs.onclose = () => console.log('Binance WS closed');
};

window.disconnectBinance = function() {
  if (binanceWs) {
    binanceWs.close();
    binanceWs = null;
  }
};