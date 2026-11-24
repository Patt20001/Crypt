const mongoose = require('mongoose');
const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'admin'], required: true },
  body: { type: String, required: true, maxlength: 5000 },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });
const supportTicketSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, required: true, maxlength: 160 },
  category: { type: String, enum: ['account', 'deposit', 'withdrawal', 'trading', 'technical', 'other'], default: 'other' },
  status: { type: String, enum: ['open', 'in_progress', 'waiting_user', 'closed'], default: 'open', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  messages: { type: [messageSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });
supportTicketSchema.index({ status: 1, updatedAt: -1 });
module.exports = mongoose.model('SupportTicket', supportTicketSchema);
