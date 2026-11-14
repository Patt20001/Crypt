const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { notify } = require('./notify');

/* ---------- TronWeb import (v5/v6/v7 compatible) ---------- */
let TronWeb;
try {
  const tronModule = require('tronweb');
  TronWeb = tronModule.TronWeb || tronModule.default || tronModule;
  if (typeof TronWeb !== 'function') throw new Error('TronWeb is not a constructor');
} catch (e) {
  console.warn('⚠️ TronWeb could not be loaded:', e.message);
  TronWeb = null;
}

const USDT_CONTRACTS = {
  TRC20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  ERC20: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  BEP20: '0x55d398326f99059fF775485246999027B3197955'
};

const REQUIRED_CONFIRMATIONS = {
  TRC20: 19,
  ERC20: 12,
  BEP20: 15
};

const RPC_URLS = {
  ERC20: process.env.ERC20_RPC_URL || 'https://eth.merkle.io',
  BEP20: process.env.BEP20_RPC_URL || 'https://bsc-rpc.publicnode.com'
};

/* Limit how many blocks we scan per tick — prevents "max results" errors */
const MAX_BLOCKS_PER_SCAN = 500;

const lastScannedBlock = { TRC20: 0, ERC20: 0, BEP20: 0 };
const errorState = { TRC20: 0, ERC20: 0, BEP20: 0 };
const MAX_REPORTED_ERRORS = 3;

function logOnce(network, msg) {
  if (errorState[network] < MAX_REPORTED_ERRORS) {
    console.warn(`[${network}] ${msg}`);
    errorState[network]++;
    if (errorState[network] === MAX_REPORTED_ERRORS) {
      console.warn(`[${network}] further errors suppressed until restart`);
    }
  }
}

/* ============================================================
   TRC20 — TronGrid block scan
   ============================================================ */
async function scanTron() {
  if (!TronWeb) return;
  try {
    const tron = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: process.env.TRONGRID_API_KEY
        ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
        : {}
    });

    const currentBlock = await tron.trx.getCurrentBlock();
    const blockNum = currentBlock.block_header.raw_data.number;

    if (!lastScannedBlock.TRC20) {
      lastScannedBlock.TRC20 = blockNum - 1;
      return;
    }

    const toScan = Math.min(blockNum, lastScannedBlock.TRC20 + 20);

    for (let b = lastScannedBlock.TRC20 + 1; b <= toScan; b++) {
      try {
        const block = await tron.trx.getBlockByNumber(b);
        if (!block?.transactions) continue;

        for (const tx of block.transactions) {
          const contract = tx.raw_data?.contract?.[0];
          if (!contract || contract.type !== 'TriggerSmartContract') continue;

          const contractAddress = tron.address.fromHex(contract.parameter.value.contract_address);
          if (contractAddress !== USDT_CONTRACTS.TRC20) continue;

          const data = contract.parameter.value.data;
          if (!data.startsWith('a9059cbb')) continue;

          const toHex = '41' + data.slice(32, 72);
          const toAddress = tron.address.fromHex(toHex);
          const amount = parseInt(data.slice(72, 136), 16) / 1e6;

          await handleTransfer({
            network: 'TRC20',
            toAddress,
            amount,
            txHash: tx.txID,
            currency: 'USDT'
          });
        }
      } catch {}
    }
    lastScannedBlock.TRC20 = toScan;
  } catch (e) {
    logOnce('TRC20', `scan error: ${e.message}`);
  }
}

/* ============================================================
   ERC20 / BEP20 — EVM block log scan
   ============================================================ */
async function scanEvm(network) {
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.JsonRpcProvider(RPC_URLS[network], undefined, {
      staticNetwork: true,
      batchMaxCount: 1
    });

    const currentBlock = await provider.getBlockNumber();

    if (!lastScannedBlock[network]) {
      lastScannedBlock[network] = currentBlock - 1;
      return;
    }

    const fromBlock = lastScannedBlock[network] + 1;
    const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCKS_PER_SCAN - 1);
    if (fromBlock > toBlock) return;

    const contract = new ethers.Contract(
      USDT_CONTRACTS[network],
      ['event Transfer(address indexed from, address indexed to, uint256 value)'],
      provider
    );

    // Query in smaller chunks to stay under RPC limits
    const CHUNK = 500;
    let scanFrom = fromBlock;
    let allLogs = [];

    while (scanFrom <= toBlock) {
      const scanTo = Math.min(scanFrom + CHUNK - 1, toBlock);
      try {
        const chunkLogs = await contract.queryFilter(
          contract.filters.Transfer(), scanFrom, scanTo
        );
        allLogs = allLogs.concat(chunkLogs);
      } catch (e) {
        logOnce(network, `chunk ${scanFrom}-${scanTo}: ${e.message}`);
        break;
      }
      scanFrom = scanTo + 1;
    }

    for (const log of allLogs) {
      const toAddress = log.args.to;
      const amount = Number(log.args.value) / 1e6;

      await handleTransfer({
        network,
        toAddress,
        amount,
        txHash: log.transactionHash,
        currency: 'USDT'
      });
    }

    lastScannedBlock[network] = toBlock;
  } catch (e) {
    logOnce(network, `scan error: ${e.message}`);
  }
}

/* ============================================================
   Universal transfer handler
   ============================================================ */
async function handleTransfer({ network, toAddress, amount, txHash, currency }) {
  try {
    const user = await User.findOne({ [`depositAddresses.${network}`]: toAddress });
    if (!user) return;

    const exists = await Transaction.findOne({
      txHash, status: { $in: ['pending', 'completed'] }
    });
    if (exists) return;

    const tx = await Transaction.create({
      user: user._id,
      type: 'deposit',
      currency,
      amount,
      status: 'pending',
      network,
      txHash,
      address: toAddress,
      confirmations: 0,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[network],
      note: `On-chain ${currency} deposit via ${network}`
    });

    console.log(`💰 ${amount} ${currency} → ${user.username} (${network})`);

    trackConfirmations(tx._id, txHash, network);

    await notify(user._id, 'deposit', 'Deposit detected',
      `${amount} ${currency} received — awaiting ${REQUIRED_CONFIRMATIONS[network]} confirmations`);
  } catch (e) {
    logOnce(network, `handleTransfer: ${e.message}`);
  }
}

/* ============================================================
   Confirmation tracker
   ============================================================ */
async function trackConfirmations(txId, txHash, network) {
  const required = REQUIRED_CONFIRMATIONS[network];
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    if (attempts > 200) { clearInterval(interval); return; }

    try {
      const tx = await Transaction.findById(txId);
      if (!tx || tx.status === 'completed') { clearInterval(interval); return; }

      let confirmations = 0;

      if (network === 'TRC20' && TronWeb) {
        const tron = new TronWeb({
          fullHost: 'https://api.trongrid.io',
          headers: process.env.TRONGRID_API_KEY
            ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
            : {}
        });
        const info = await tron.trx.getTransactionInfo(txHash);
        if (info?.blockNumber) {
          const cur = await tron.trx.getCurrentBlock();
          confirmations = cur.block_header.raw_data.number - info.blockNumber;
        }
      } else {
        const { ethers } = require('ethers');
        const provider = new ethers.JsonRpcProvider(RPC_URLS[network], undefined, {
          staticNetwork: true,
          batchMaxCount: 1
        });
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
          const cur = await provider.getBlockNumber();
          confirmations = cur - receipt.blockNumber;
        }
      }

      tx.confirmations = confirmations;
      await tx.save();

      if (confirmations >= required) {
        const user = await User.findById(tx.user);
        user.balances[tx.currency] = (user.balances[tx.currency] || 0) + tx.amount;
        await user.save();

        tx.status = 'completed';
        await tx.save();

        await notify(user._id, 'deposit', 'Deposit confirmed',
          `${tx.amount} ${tx.currency} credited to your wallet`);
        console.log(`✅ Credited ${tx.amount} ${tx.currency} to ${user.username}`);
        clearInterval(interval);
      }
    } catch (e) {
      logOnce(network, `confirm: ${e.message}`);
    }
  }, 15000);
}

/* ============================================================
   Start / stop
   ============================================================ */
let scanInterval = null;

function start() {
  if (scanInterval) return;
  console.log('🔍 Blockchain watcher started (TRC20 / ERC20 / BEP20)');
  scanInterval = setInterval(async () => {
    if (TronWeb) await scanTron();
    await scanEvm('ERC20');
    await scanEvm('BEP20');
  }, 30000);

  if (TronWeb) scanTron().catch(() => {});
  scanEvm('ERC20').catch(() => {});
  scanEvm('BEP20').catch(() => {});
}

function stop() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}

module.exports = { start, stop, handleTransfer, trackConfirmations };