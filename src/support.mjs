import { createAlgorandUsdcRail, DEFAULT_INDEXER, isAlgorandAddress, parseIndexerTransaction, paymentLink } from '../vendor/fairground/src/rails/algorand.ts';
import { transferProblem } from '../vendor/fairground/src/rails/rail.ts';
import { HostingError, requireThat } from './protocol.mjs';
// Public chain reads are bounded and never follow redirects.
const indexerFetch = async (url) => {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return response;
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1_000_000) throw new HostingError('E_LIMIT', 'Indexer response exceeds limit.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
};
export const algorandUsdc = createAlgorandUsdcRail(undefined, indexerFetch);
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export function donationPlan(manifest, amounts, { now = Math.floor(Date.now() / 1000), nonce = hex(crypto.getRandomValues(new Uint8Array(16))) } = {}) {
  requireThat(amounts && typeof amounts === 'object' && !Array.isArray(amounts) && /^[a-f0-9]{32}$/.test(nonce) && Number.isSafeInteger(now), 'E_DONATION', 'Invalid donation plan.');
  const selected = Object.keys(amounts); requireThat(selected.length > 0 && selected.length <= 12, 'E_DONATION', 'Choose at least one recipient.');
  const payments = selected.map((id) => {
    const recipient = manifest.support.recipients.find((r) => r.id === id);
    requireThat(recipient?.reviewed === true && isAlgorandAddress(recipient.address), 'E_DONATION', 'Recipient is not reviewed in this release.');
    const amount = amounts[id]; requireThat(typeof amount === 'string' && /^\d{1,10}$/.test(amount) && BigInt(amount) > 0n && BigInt(amount) <= 1_000_000_000n, 'E_DONATION', 'Use positive USDC micro-units, at most 1000 USDC per recipient.');
    const memo = `evolve:hosting:${manifest.project.id}:${id}:${nonce}`;
    requireThat(new TextEncoder().encode(memo).length <= 200, 'E_DONATION', 'Donation note is too long.');
    const payment = { to: recipient.address, amount: BigInt(amount), memo };
    return { id, name: recipient.name, role: recipient.role, ...payment, link: paymentLink(payment), earliestTime: now, expiresAt: now + 3600 };
  });
  return { schema: 'evolve-hosting.donation.v1', payments, total: payments.reduce((n, p) => n + p.amount, 0n) };
}
export function confirmDonation(payment, response, used = new Set(), now = Math.floor(Date.now() / 1000)) {
  const tx = response?.transaction;
  requireThat(Number.isSafeInteger(tx?.['confirmed-round']) && tx['confirmed-round'] > 0 && Number.isSafeInteger(tx?.['round-time']) && tx['round-time'] > 0, 'E_RECEIPT', 'Transaction is not confirmed.');
  return confirmTransfer(payment, parseIndexerTransaction(response), used, now);
}
export function confirmTransfer(payment, transfer, used = new Set(), now = Math.floor(Date.now() / 1000)) {
  requireThat(!used.has(transfer.id), 'E_RECEIPT', 'This receipt has already been used in this session.');
  const problem = transferProblem(payment, transfer, payment.earliestTime);
  requireThat(!problem && transfer.amount === payment.amount && transfer.time <= payment.expiresAt && transfer.time <= now + 60 && now <= payment.expiresAt, 'E_RECEIPT', problem || 'Receipt amount or confirmation window does not match.');
  used.add(transfer.id); return transfer;
}
export async function prepareDonation(plan, rail = algorandUsdc) {
  for (const p of plan.payments) requireThat(await rail.canReceive(p.to), 'E_NOT_READY', `${p.name} cannot currently receive native USDC on Algorand. No payment was prepared.`);
  return plan;
}

export async function fetchDonationReceipt(payment, txid, used) {
  requireThat(typeof txid === 'string' && /^[A-Z2-7]{52}$/.test(txid), 'E_RECEIPT', 'Supply a valid Algorand transaction ID.');
  const response = await indexerFetch(`${DEFAULT_INDEXER}/v2/transactions/${txid}`);
  requireThat(response.ok, 'E_RECEIPT', 'Could not retrieve the confirmed transaction.');
  const raw = await response.json();
  requireThat(raw?.transaction?.id === txid, 'E_RECEIPT', 'Indexer returned a different transaction.');
  return confirmDonation(payment, raw, used);
}
