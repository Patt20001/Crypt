const Notification = require('../models/Notification');

async function notify(userId, type, title, body = '', link = '') {
  try {
    await Notification.create({ user: userId, type, title, body, link });
  } catch (e) {
    console.error('notify error:', e.message);
  }
}

module.exports = { notify };