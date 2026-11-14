const express = require('express');
const router = express.Router();

const NETWORKS = [
  {
    id: 'TRC20',
    name: 'Tron (TRC20)',
    color: '#ef4444',
    confirmations: 19,
    explorer: 'https://tronscan.org/#/address/',
    currencies: [
      { symbol: 'USDT', minDeposit: 1,  minWithdraw: 10, fee: 1,   decimals: 2 }
    ]
  },
  {
    id: 'ERC20',
    name: 'Ethereum (ERC20)',
    color: '#627eea',
    confirmations: 12,
    explorer: 'https://etherscan.io/address/',
    currencies: [
      { symbol: 'USDT', minDeposit: 10,    minWithdraw: 20,    fee: 8,     decimals: 2 },
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
      { symbol: 'USDT', minDeposit: 1,    minWithdraw: 5,    fee: 0.5,   decimals: 2 },
      { symbol: 'BNB',  minDeposit: 0.01, minWithdraw: 0.05, fee: 0.001, decimals: 4 }
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