const mongoose = require('mongoose');

const withdrawalAddressSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  label:      { type: String, default: '', maxlength: 40, trim: true },
  network:    { type: String, enum: ['TRC20', 'ERC20', 'BEP20'], required: true },
  address:    { type: String, required: true },
  addressKey: { type: String, required: true },          // normalised for comparison (lower-cased for 0x addresses)
  createdAt:  { type: Date, default: Date.now },
  activeAt:   { type: Date, required: true }              // cooling-off: address can't be used before this time
});
withdrawalAddressSchema.index({ user: 1, network: 1, addressKey: 1 }, { unique: true });

module.exports = mongoose.model('WithdrawalAddress', withdrawalAddressSchema);
