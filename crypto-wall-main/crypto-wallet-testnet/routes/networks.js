const express = require('express');
const router = express.Router();

const NETWORKS = [
  { id: 'TRC20', name: 'Tron (TRC20)',  symbol: 'USDT', minDeposit: 1,   minWithdraw: 10, fee: 1,    confirmations: 19, color: '#ef4444', explorer: 'https://tronscan.org/#/address/' },
  { id: 'ERC20', name: 'Ethereum (ERC20)', symbol: 'USDT', minDeposit: 10, minWithdraw: 20, fee: 8,    confirmations: 12, color: '#627eea', explorer: 'https://etherscan.io/address/' },
  { id: 'BEP20', name: 'BNB Chain (BEP20)', symbol: 'USDT', minDeposit: 1, minWithdraw: 5,  fee: 0.5,  confirmations: 15, color: '#f0b90b', explorer: 'https://bscscan.com/address/' },
  { id: 'SOL',   name: 'Solana (SPL)',     symbol: 'USDT', minDeposit: 1, minWithdraw: 1,  fee: 0.1,  confirmations: 1,  color: '#14f195', explorer: 'https://solscan.io/account/' }
];

router.get('/', (req, res) => res.json(NETWORKS));
router.get('/:id', (req, res) => {
  const n = NETWORKS.find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Unknown network' });
  res.json(n);
});

module.exports = router;