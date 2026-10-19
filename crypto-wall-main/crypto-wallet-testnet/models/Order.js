const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  side:     { type: String, enum: ['buy', 'sell'], required: true },
  pair:     { type: String, enum: ['BTC/USDT', 'ETH/USDT'], required: true },
  type:     { type: String, enum: ['limit', 'market'], default: 'limit' },
  price:    { type: Number, required: true },   // price per unit
  amount:   { type: Number, required: true },   // amount of base (BTC or ETH)
  filled:   { type: Number, default: 0 },       // amount filled so far
  status:   { type: String, enum: ['open', 'partial', 'filled', 'cancelled'], default: 'open' },
  createdAt:{ type: Date, default: Date.now },
  updatedAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
