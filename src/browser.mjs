import { base64 } from '@scure/base';
import { canonical, LIMITS, parseEnvelope, requireThat } from './protocol.mjs';
import { isAlgorandAddress } from '../vendor/fairground/src/rails/algorand.ts';
export const decode64 = (s) => base64.decode(s);
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const digest = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export async function verifyBrowser(text, pem) {
  requireThat(new TextEncoder().encode(text).length <= LIMITS.bundle, 'E_LIMIT', 'Bundle exceeds browser size limit.');
  const envelope = parseEnvelope(JSON.parse(text));
  requireThat(/^-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/.test(pem), 'E_KEY', 'Supply an Ed25519 public key in PEM format.');
  const der = decode64(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
  const key = await crypto.subtle.importKey('spki', der, 'Ed25519', false, ['verify']);
  const message = new TextEncoder().encode(canonical(envelope.manifest));
  requireThat(await crypto.subtle.verify('Ed25519', key, decode64(envelope.signature), message), 'E_SIGNATURE', 'This release was not signed by the supplied key.');
  for (const r of envelope.manifest.support.recipients) requireThat(isAlgorandAddress(r.address), 'E_ADDRESS', 'Recipient address checksum is invalid.');
  for (let i = 0; i < envelope.assets.length; i++) {
    const asset = envelope.assets[i], expected = envelope.manifest.files[i], bytes = decode64(asset.data);
    requireThat(bytes.length === expected.size && await digest(bytes) === expected.sha256, 'E_INTEGRITY', 'An asset differs from the signed release.');
  }
  return { id: await digest(message), fingerprint: await digest(der), manifest: envelope.manifest, text, pem };
}
export async function boundedText(url, max = LIMITS.bundle) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000), credentials: 'omit' });
  requireThat(response.ok, 'E_NETWORK', 'The public resource is unavailable.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireThat(size <= max, 'E_LIMIT', 'Resource exceeds size limit.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const buffer = new Uint8Array(size); let offset = 0; for (const c of chunks) { buffer.set(c, offset); offset += c.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}
