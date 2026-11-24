const mongoose = require('mongoose');

const swapSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from:      { type: String, enum: ['USDT','BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LTC','TRX','DOT','AVAX','LINK','BCH','TON','NEAR','ATOM','UNI'], required: true },
  to:        { type: String, enum: ['USDT','BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LTC','TRX','DOT','AVAX','LINK','BCH','TON','NEAR','ATOM','UNI'], required: true },
  fromAmount:{ type: Number, required: true },
  toAmount:  { type: Number, required: true },
  rate:      { type: Number, required: true }, // 1 unit of `from` -> rate units of `to`
  status:    { type: String, enum: ['completed'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Swap', swapSchema);