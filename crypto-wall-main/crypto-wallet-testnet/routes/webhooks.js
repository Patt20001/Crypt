const express = require('express');
const crypto = require('crypto');
const { handleTransfer } = require('../middleware/blockchainWatcher'); // Reuse your existing handler
const router = express.Router();

// The signing key from your Alchemy Webhook dashboard
const SIGNING_KEYS = {
  ERC20: process.env.ALCHEMY_SIGNING_KEY_ERC20,
  BEP20: process.env.ALCHEMY_SIGNING_KEY_BEP20
};

router.post('/alchemy', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-alchemy-signature'];
  const rawBody = req.body;

  if (!signature) return res.status(401).send('Missing signature');

  // Parse to find the network
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // Determine network from payload
  let network = 'ERC20';
  if (payload.network && String(payload.network).toUpperCase().includes('BNB')) {
    network = 'BEP20';
  }

  // Verify signature using the corresponding key
  const signingKey = SIGNING_KEYS[network];
  if (!signingKey) {
    console.warn(`No signing key configured for ${network}`);
    return res.status(401).send('Unauthorized');
  }

  const digest = crypto
    .createHmac('sha256', signingKey)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return res.status(401).send('Invalid signature');
  }

  // Process activity
  if (payload.type === 'ADDRESS_ACTIVITY' && payload.event?.activity) {
    for (const activity of payload.event.activity) {
      if (activity.category === 'token' && activity.toAddress) {
        await handleTransfer({
          network,
          toAddress: activity.toAddress.toLowerCase(),
          amount: parseFloat(activity.value),
          txHash: activity.hash,
          currency: 'USDT'
        });
      }
    }
  }

  res.status(200).send('OK');
});

module.exports = router;