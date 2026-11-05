import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFile, lstat, realpath, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { canonical, HostingError, LIMITS, parseEnvelope, requireThat, safePath, validateManifest } from './protocol.mjs';
import { isAlgorandAddress } from '../vendor/fairground/src/rails/algorand.ts';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function publicKey(pem) {
  requireThat((typeof pem === 'string' || Buffer.isBuffer(pem)) && /^-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/.test(pem.toString()), 'E_KEY', 'Supply only a public Ed25519 SPKI PEM key. Private keys are never accepted as trust-key inputs.');
  let key; try { key = createPublicKey(pem); } catch { throw new HostingError('E_KEY', 'Could not read public key.'); }
  requireThat(key.asymmetricKeyType === 'ed25519', 'E_KEY', 'An Ed25519 public key is required.'); return key;
}
export const fingerprint = (pem) => sha256(publicKey(pem).export({ type: 'spki', format: 'der' }));
export async function readBounded(path, maximum = LIMITS.bundle) {
  const info = await lstat(path);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'E_LIMIT', 'Input must be a bounded regular file.');
  const bytes = await readFile(path);
  requireThat(bytes.length <= maximum, 'E_LIMIT', 'Input exceeds size limit.'); return bytes;
}
export async function readJSON(path, maximum = LIMITS.bundle) {
  const bytes = await readBounded(path, maximum);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new HostingError('E_JSON', 'Could not parse JSON input.'); }
}
export function verifyBundle(input, trustedPublicKey) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
  requireThat(bytes.length <= LIMITS.bundle, 'E_LIMIT', 'Bundle exceeds size limit.');
  let envelope; try { envelope = JSON.parse(bytes.toString('utf8')); } catch { throw new HostingError('E_JSON', 'Could not parse bundle.'); }
  parseEnvelope(envelope);
  const message = Buffer.from(canonical(envelope.manifest));
  requireThat(verify(null, message, publicKey(trustedPublicKey), Buffer.from(envelope.signature, 'base64')), 'E_SIGNATURE', 'Release was not signed by the trusted key.');
  for (const r of envelope.manifest.support.recipients) requireThat(isAlgorandAddress(r.address), 'E_ADDRESS', 'A reviewed recipient address has an invalid checksum.');
  const files = new Map();
  for (let i = 0; i < envelope.assets.length; i++) {
    const asset = envelope.assets[i], expected = envelope.manifest.files[i], data = Buffer.from(asset.data, 'base64');
    requireThat(data.toString('base64') === asset.data && data.length === expected.size && sha256(data) === expected.sha256, 'E_INTEGRITY', 'Asset size or hash does not match the signed manifest.');
    files.set(asset.path, data);
  }
  return { id: sha256(message), fingerprint: fingerprint(trustedPublicKey), manifest: envelope.manifest, envelope, files, bytes };
}
export async function generateKeys(privatePath, publicPath) {
  requireThat(resolve(privatePath) !== resolve(publicPath), 'E_PATH', 'Key paths must differ.');
  const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
  await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  const pem = key.export({ type: 'spki', format: 'pem' });
  // Refuse existing files rather than replacing an established trust root.
  try { await writeFile(publicPath, pem, { flag: 'wx', mode: 0o644 }); }
  catch (error) { await unlink(privatePath); throw error; }
  return { fingerprint: fingerprint(pem), publicKey: pem };
}
export async function pack(configFile, privatePath, output) {
  const config = await readJSON(configFile, 100_000);
  const { root, include, ...metadata } = config;
  requireThat(typeof root === 'string' && Array.isArray(include) && include.length <= LIMITS.files, 'E_CONFIG', 'Declare a root and an explicit public-file include list.');
  const base = resolve(dirname(configFile), root);
  requireThat(!(await lstat(base)).isSymbolicLink(), 'E_PATH', 'The asset root must not be a symlink.');
  const realBase = await realpath(base), assets = [], files = [];
  for (const path of [...include].sort()) {
    safePath(path);
    let candidate = realBase;
    for (const part of path.split('/')) {
      candidate = join(candidate, part);
      requireThat(!(await lstat(candidate)).isSymbolicLink(), 'E_PATH', 'Asset paths cannot contain symlinks.');
    }
    const data = await readBounded(candidate, LIMITS.file);
    requireThat(!/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(data.toString('utf8')), 'E_PRIVATE', 'Private key material cannot enter a release.');
    files.push({ path, size: data.length, sha256: sha256(data) }); assets.push({ path, data: data.toString('base64') });
  }
  const manifest = validateManifest({ ...metadata, createdAt: new Date().toISOString(), files });
  let key; try { key = createPrivateKey(await readBounded(privatePath, 16_000)); } catch { throw new HostingError('E_KEY', 'Could not read signing key.'); }
  requireThat(key.asymmetricKeyType === 'ed25519', 'E_KEY', 'An Ed25519 signing key is required.');
  const envelope = { schema: 'evolve-hosting.bundle.v1', manifest, signature: sign(null, Buffer.from(canonical(manifest)), key).toString('base64'), assets };
  const verified = verifyBundle(envelope, createPublicKey(key).export({ type: 'spki', format: 'pem' }));
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(envelope) + '\n', { flag: 'wx', mode: 0o644 });
  return verified;
}
