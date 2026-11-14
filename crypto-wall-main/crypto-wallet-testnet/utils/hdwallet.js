const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { ethers } = require('ethers');

const MASTER_MNEMONIC = process.env.WALLET_MNEMONIC;
if (!MASTER_MNEMONIC) {
  console.warn('⚠️ WALLET_MNEMONIC not set — using dev fallback (DO NOT USE IN PRODUCTION)');
}

const seed = mnemonicToSeedSync(
  MASTER_MNEMONIC ||
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
);
const master = HDKey.fromMasterSeed(seed);

const PATHS = {
  TRC20: (i) => `m/44'/195'/0'/0/${i}`,
  ERC20: (i) => `m/44'/60'/0'/0/${i}`,
  BEP20: (i) => `m/44'/60'/0'/0/${i}`
};

/* ---------------- PUBLIC API ---------------- */

function deriveAddress(network, index) {
  const path = PATHS[network];
  if (!path) throw new Error(`Unsupported network: ${network}`);

  const child = master.derive(path(index));
  if (!child.publicKey) throw new Error('Failed to derive key');

  switch (network) {
    case 'TRC20':
      return deriveTronAddress(child.publicKey);
    case 'ERC20':
    case 'BEP20':
      return deriveEvmAddress(child.publicKey);
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

function derivePrivateKey(network, index) {
  const path = PATHS[network];
  if (!path) throw new Error(`Unsupported network: ${network}`);

  const child = master.derive(path(index));
  const pk = child.privateKey;

  if (!pk) throw new Error('Failed to derive private key');
  return Buffer.from(pk).toString('hex');
}

/* ---------------- EVM address derivation ---------------- */
function deriveEvmAddress(pubKey) {
  // ethers.computeAddress accepts the compressed pubkey
  // and returns the correct checksummed address
  const hexPubKey = '0x' + Buffer.from(pubKey).toString('hex');
  return ethers.computeAddress(hexPubKey);
}

/* ---------------- Tron address derivation ---------------- */
function deriveTronAddress(pubKey) {
  const tronModule = require('tronweb');
  const TronWeb = tronModule.TronWeb || tronModule.default || tronModule;

  // Step 1: get the uncompressed pubkey
  // ethers.computeAddress gives us the ETH-format address (0x...)
  // For Tron: strip 0x, add 41 prefix, then TronWeb.address.fromHex
  const ethAddress = ethers.computeAddress('0x' + Buffer.from(pubKey).toString('hex'));
  const hexAddress = '41' + ethAddress.slice(2).toLowerCase();

  return TronWeb.address.fromHex(hexAddress);
}

function destroy() {
  try { master.wipePrivateData?.(); } catch {}
}

module.exports = {
  deriveAddress,
  derivePrivateKey,
  destroy,
  PATHS
};