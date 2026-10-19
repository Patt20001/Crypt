const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  side:     { type: String, enum: ['buy', 'sell'], required: true },
  pair:     { type: String, required: true },        // 'BTC/USDT', 'SOL/USDT', etc.
  type:     { type: String, enum: ['limit', 'market'], default: 'limit' },
  conditionalType: {
    type: String,
    enum: ['', 'stop_loss', 'take_profit'],
    default: ''
  },
  triggerPrice: { type: Number, default: 0 },         // for SL/TP
  price:    { type: Number, required: true },
  amount:   { type: Number, required: true },
  filled:   { type: Number, default: 0 },
  status:   { type: String, enum: ['open', 'partial', 'filled', 'cancelled'], default: 'open' },
  createdAt:{ type: Date, default: Date.now },
  updatedAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);