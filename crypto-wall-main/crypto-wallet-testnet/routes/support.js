const express = require('express');
const SupportTicket = require('../models/SupportTicket');
const { auth } = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id }).select('subject category status priority messages createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean();
    res.json(tickets);
  } catch (e) { res.status(500).json({ error: 'Could not load support tickets' }); }
});
router.post('/', async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.message || '').trim();
    const category = ['account','deposit','withdrawal','trading','technical','other'].includes(req.body.category) ? req.body.category : 'other';
    if (subject.length < 4 || subject.length > 160) return res.status(400).json({ error: 'Subject must be 4–160 characters' });
    if (body.length < 10 || body.length > 5000) return res.status(400).json({ error: 'Message must be 10–5000 characters' });
    const ticket = await SupportTicket.create({ user: req.user._id, subject, category, messages: [{ sender: 'user', body }] });
    res.status(201).json(ticket);
  } catch (e) { res.status(500).json({ error: 'Could not create support ticket' }); }
});
router.post('/:id/reply', async (req, res) => {
  try {
    const body = String(req.body.message || '').trim();
    if (body.length < 2 || body.length > 5000) return res.status(400).json({ error: 'Reply must be 2–5000 characters' });
    const ticket = await SupportTicket.findOne({ _id: req.params.id, user: req.user._id, status: { $ne: 'closed' } });
    if (!ticket) return res.status(404).json({ error: 'Open ticket not found' });
    ticket.messages.push({ sender: 'user', body }); ticket.status = 'open'; ticket.updatedAt = new Date();
    await ticket.save(); res.json(ticket);
  } catch (e) { res.status(500).json({ error: 'Could not send reply' }); }
});
module.exports = router;
