const ALCHEMY_AUTH_TOKEN = process.env.ALCHEMY_AUTH_TOKEN;
const ALCHEMY_WEBHOOK_URL = 'https://dashboard.alchemy.com/api/update-webhook-addresses';

/* Map network → webhook_id from environment */
const WEBHOOK_IDS = {
  ERC20: process.env.ALCHEMY_WEBHOOK_ID_ERC20 || '',
  BEP20: process.env.ALCHEMY_WEBHOOK_ID_BEP20 || ''
};

/**
 * Add addresses to a specific network's Alchemy webhook.
 * @param {string} network - 'ERC20' or 'BEP20'
 * @param {string[]} addresses - addresses to add
 */
async function addAddressesToWebhook(network, addresses) {
  const webhookId = WEBHOOK_IDS[network];
  if (!webhookId || !ALCHEMY_AUTH_TOKEN) {
    console.warn(`Alchemy webhook credentials missing for ${network} — skipping`);
    return;
  }
  if (!addresses.length) return;

  try {
    const res = await fetch(ALCHEMY_WEBHOOK_URL, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': ALCHEMY_AUTH_TOKEN
      },
      body: JSON.stringify({
        webhook_id: webhookId,
        addresses_to_add: addresses,
        addresses_to_remove: []
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Alchemy webhook update failed (${network}):`, res.status, err);
    } else {
      console.log(`✅ Added ${addresses.length} address(es) to ${network} webhook`);
    }
  } catch (e) {
    console.error(`Alchemy webhook add error (${network}):`, e.message);
  }
}

module.exports = { addAddressesToWebhook };