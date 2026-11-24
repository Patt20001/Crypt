const express = require('express');
const router = express.Router();
const COINS = 'bitcoin,ethereum,tether,binancecoin,solana,ripple,usd-coin,dogecoin,cardano,tron';
let cached = { at: 0, data: [] };

router.get('/strip', async (req, res) => {
  if (cached.data.length && Date.now() - cached.at < 30000) return res.json({ items: cached.data, updatedAt: cached.at });
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${COINS}&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h`;
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
    const coins = await response.json();
    cached = {
      at: Date.now(),
      data: coins.slice(0, 10).map(c => ({
        id: c.id, symbol: String(c.symbol || '').toUpperCase(), name: c.name,
        price: Number(c.current_price), change24h: Number(c.price_change_percentage_24h || 0)
      }))
    };
    res.json({ items: cached.data, updatedAt: cached.at });
  } catch (e) {
    if (cached.data.length) return res.json({ items: cached.data, updatedAt: cached.at, stale: true });
    res.status(503).json({ error: 'Live market data is temporarily unavailable' });
  }
});
module.exports = router;
