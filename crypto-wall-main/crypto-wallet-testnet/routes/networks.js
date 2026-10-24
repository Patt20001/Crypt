const express = require('express');
const router = express.Router();

/* Each network has a list of supported currencies */
const NETWORKS = [
  {
    id: 'TRC20',
    name: 'Tron (TRC20)',
    color: '#ef4444',
    confirmations: 19,
    explorer: 'https://tronscan.org/#/address/',
    currencies: [
      { symbol: 'USDT', minDeposit: 1, minWithdraw: 10, fee: 1, decimals: 2 }
    ]
  },
  {
    id: 'ERC20',
    name: 'Ethereum (ERC20)',
    color: '#627eea',
    confirmations: 12,
    explorer: 'https://etherscan.io/address/',
    currencies: [
      { symbol: 'USDT', minDeposit: 10, minWithdraw: 20, fee: 8,   decimals: 2 },
      { symbol: 'ETH',  minDeposit: 0.001, minWithdraw: 0.005, fee: 0.003, decimals: 6 }
    ]
  },
  {
    id: 'BEP20',
    name: 'BNB Chain (BEP20)',
    color: '#f0b90b',
    confirmations: 15,
    explorer: 'https://bscscan.com/address/',
    currencies: [
      { symbol: 'USDT', minDeposit: 1, minWithdraw: 5, fee: 0.5, decimals: 2 },
      { symbol: 'BNB',  minDeposit: 0.01, minWithdraw: 0.05, fee: 0.001, decimals: 4 }
    ]
  },
  {
    id: 'SOL',
    name: 'Solana',
    color: '#14f195',
    confirmations: 1,
    explorer: 'https://solscan.io/account/',
    currencies: [
      { symbol: 'USDT', minDeposit: 1,  minWithdraw: 1,  fee: 0.1,   decimals: 2 },
      { symbol: 'SOL',  minDeposit: 0.01, minWithdraw: 0.02, fee: 0.001, decimals: 4 }
    ]
  },
  {
    id: 'BTC',
    name: 'Bitcoin',
    color: '#f7931a',
    confirmations: 3,
    explorer: 'https://mempool.space/address/',
    currencies: [
      { symbol: 'BTC', minDeposit: 0.0001, minWithdraw: 0.0005, fee: 0.0001, decimals: 6 }
    ]
  },
  {
    id: 'XRP',
    name: 'XRP Ledger',
    color: '#23292f',
    confirmations: 1,
    explorer: 'https://xrpscan.com/account/',
    currencies: [
      { symbol: 'XRP', minDeposit: 1, minWithdraw: 5, fee: 0.1, decimals: 4 }
    ]
  },
  {
    id: 'ADA',
    name: 'Cardano',
    color: '#0033ad',
    confirmations: 15,
    explorer: 'https://cardanoscan.io/address/',
    currencies: [
      { symbol: 'ADA', minDeposit: 1, minWithdraw: 5, fee: 0.5, decimals: 2 }
    ]
  },
  {
    id: 'DOGE',
    name: 'Dogecoin',
    color: '#c2a633',
    confirmations: 6,
    explorer: 'https://dogechain.info/address/',
    currencies: [
      { symbol: 'DOGE', minDeposit: 5, minWithdraw: 20, fee: 2, decimals: 2 }
    ]
  }
];

router.get('/', (req, res) => res.json(NETWORKS));

router.get('/:id', (req, res) => {
  const n = NETWORKS.find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Unknown network' });
  res.json(n);
});

module.exports = router;