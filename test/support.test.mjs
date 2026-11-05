import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { donationPlan, prepareDonation, confirmDonation } from '../src/support.mjs';
import { MAINNET_GENESIS_HASH, USDC_ASSET_ID, encodeAddress } from '../vendor/fairground/src/rails/algorand.ts';
const manifest = JSON.parse(await readFile(new URL('../examples/commons/hosting.json', import.meta.url), 'utf8'));
const now = 1_800_000_000;
const plan = () => donationPlan(manifest, { evolvetech: '5000000' }, { now, nonce: 'a'.repeat(32) });
const tx = payment => ({ transaction: {
  id: 'A'.repeat(52), sender: encodeAddress(new Uint8Array(32).fill(2)), 'genesis-hash': MAINNET_GENESIS_HASH,
  'tx-type': 'axfer', 'confirmed-round': 100, 'round-time': now + 2,
  note: Buffer.from(payment.memo).toString('base64'),
  'asset-transfer-transaction': { 'asset-id': USDC_ASSET_ID, receiver: payment.to, amount: Number(payment.amount) },
} });

test('Fairground rail prepares explicit direct wallet requests without taking custody', () => {
  const p = plan(); assert.equal(p.total, 5000000n); assert.equal(p.payments.length, 1);
  const link = new URL(p.payments[0].link);
  assert.equal(link.protocol, 'algorand:'); assert.equal(link.searchParams.get('amount'), '5000000');
  assert.equal(link.searchParams.get('asset'), String(USDC_ASSET_ID)); assert.equal(link.searchParams.get('xnote'), p.payments[0].memo);
  assert.match(p.payments[0].memo, /evolve:hosting:commons-board:evolvetech:/);
  assert.notEqual(donationPlan(manifest, { evolvetech: '5000000' }).payments[0].memo, donationPlan(manifest, { evolvetech: '5000000' }).payments[0].memo);
});

test('unreviewed, unknown, empty, invalid or oversized donations are rejected', () => {
  for (const amount of ['0', '-1', '1.25', '1000000001', 'NaN']) assert.throws(() => donationPlan(manifest, { evolvetech: amount }));
  assert.throws(() => donationPlan(manifest, {})); assert.throws(() => donationPlan(manifest, { forged: '1' }));
  const bad = structuredClone(manifest); bad.support.recipients[0].reviewed = false;
  assert.throws(() => donationPlan(bad, { evolvetech: '1' }));
});

test('recipient opt-in failure prevents all wallet links from being offered', async () => {
  await assert.rejects(prepareDonation(plan(), { canReceive: async () => false }), { code: 'E_NOT_READY' });
  await assert.rejects(prepareDonation(plan(), { canReceive: async () => { throw Error('indexer offline'); } }));
  assert.equal((await prepareDonation(plan(), { canReceive: async () => true })).payments.length, 1);
});

test('receipts must match network, asset, recipient, exact amount, note and confirmation window', () => {
  const payment = plan().payments[0];
  assert.equal(confirmDonation(payment, tx(payment), new Set(), now + 3).amount, 5000000n);
  for (const alter of [
    t => t['genesis-hash'] = 'testnet', t => t['tx-type'] = 'pay', t => t['confirmed-round'] = 0,
    t => t['asset-transfer-transaction']['asset-id'] = 123,
    t => t['asset-transfer-transaction'].receiver = encodeAddress(new Uint8Array(32).fill(3)),
    t => t['asset-transfer-transaction'].amount = 4999999,
    t => t['asset-transfer-transaction'].amount = 5000001,
    t => t.note = Buffer.from('another payment').toString('base64'),
    t => t['round-time'] = now - 1, t => t['round-time'] = now + 3601,
  ]) { const value = tx(payment); alter(value.transaction); assert.throws(() => confirmDonation(payment, value, new Set(), now + 3)); }
  assert.throws(() => confirmDonation(payment, tx(payment), new Set(), now + 3601));
});

test('one receipt cannot satisfy two payments in the same confirmation session', () => {
  const payment = plan().payments[0], used = new Set();
  confirmDonation(payment, tx(payment), used, now + 3);
  assert.throws(() => confirmDonation(payment, tx(payment), used, now + 3), { code: 'E_RECEIPT' });
});

test('an explicit development/hosting split has distinct notes and receipts', async () => {
  const split = structuredClone(manifest);
  split.support.recipients.push({ ...split.support.recipients[0], id: 'mirror-operator', name: 'Fixture operator', role: 'hosting', address: encodeAddress(new Uint8Array(32).fill(4)) });
  const result = donationPlan(split, { evolvetech: '2000000', 'mirror-operator': '3000000' }, { now, nonce: 'b'.repeat(32) });
  assert.equal(result.total, 5000000n); assert.notEqual(result.payments[0].memo, result.payments[1].memo);
  const used = new Set(), first = tx(result.payments[0]), second = tx(result.payments[1]); second.transaction.id = 'B'.repeat(52);
  assert.throws(() => confirmDonation(result.payments[1], first, used, now + 3));
  confirmDonation(result.payments[0], first, used, now + 3); confirmDonation(result.payments[1], second, used, now + 3);
  assert.equal(used.size, 2);
});
