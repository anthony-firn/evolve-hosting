import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, symlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { pack, verifyBundle, generateKeys, fingerprint } from '../src/release.mjs';
import { canonical, safePath, validateManifest, LIMITS } from '../src/protocol.mjs';

test('portable release verifies with the separately supplied Ed25519 trust key', async t => {
  const f = await fixture(t), result = verifyBundle(await readFile(f.bundle), f.key);
  assert.equal(result.id, f.release.id); assert.equal(result.fingerprint, fingerprint(f.key));
  assert.equal(result.files.get('index.html').toString(), '<h1>First release</h1>');
  assert.equal((await stat(f.keyPath)).mode & 0o777, 0o600);
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifyBundle(result.envelope, other), { code: 'E_SIGNATURE' });
});

test('modified metadata, assets, duplicate assets and extra fields are rejected', async t => {
  const f = await fixture(t);
  const change = callback => { const value = structuredClone(f.release.envelope); callback(value); return value; };
  for (const value of [
    change(v => v.manifest.project.name = 'Forged'),
    change(v => v.assets[0].data = Buffer.from('modified').toString('base64')),
    change(v => v.assets.push(v.assets[0])),
    change(v => v.surprise = 'ignored?'),
    change(v => v.signature = 'not-base64'),
  ]) assert.throws(() => verifyBundle(value, f.key));
});

test('signed manifests still enforce paths, sizes, counts and strict schemas', async t => {
  const f = await fixture(t);
  for (const path of ['../index.html', '/index.html', 'assets/../index.html', '.env', 'assets/.env.json', 'node_modules/package.js', 'private/export.json', 'x\\y.js', 'a//b.js', 'a%2fb.js', 'server.sh']) assert.throws(() => safePath(path), { code: 'E_PATH' });
  for (const modify of [
    m => m.files[0].path = 'Index.html',
    m => m.files[0].size = LIMITS.file + 1,
    m => m.files.push({ ...m.files[0], path: 'INDEX.html' }),
    m => m.files = Array.from({ length: LIMITS.files + 1 }, () => m.files[0]),
    m => m.sequence = 0,
    m => m.mirrors = [{ name: 'Credentials in URL', url: 'https://user:secret@example.org/' }],
    m => m.support.recipients[0].reviewed = false,
    m => m.backends = [{ name: 'API', purpose: 'Wrong scheme', url: 'javascript:alert(1)' }],
  ]) {
    const envelope = structuredClone(f.release.envelope); modify(envelope.manifest);
    envelope.signature = sign(null, Buffer.from(canonical(envelope.manifest)), createPrivateKey(await readFile(f.keyPath))).toString('base64');
    assert.throws(() => verifyBundle(envelope, f.key));
  }
});

test('packing refuses symlinks, hidden files and private key material', async t => {
  const f = await fixture(t);
  await symlink(f.keyPath, join(f.root, 'app/leak.txt'));
  for (const name of ['leak.txt', '.env']) {
    f.config.include = ['index.html', name]; await writeFile(f.configPath, JSON.stringify(f.config));
    await assert.rejects(pack(f.configPath, f.keyPath, join(f.root, name + '.json')));
  }
  await mkdir(join(f.root, 'outside')); await writeFile(join(f.root, 'outside/private.txt'), await readFile(f.keyPath));
  await symlink(join(f.root, 'outside'), join(f.root, 'app/linked'));
  f.config.include = ['index.html', 'linked/private.txt']; await writeFile(f.configPath, JSON.stringify(f.config));
  await assert.rejects(pack(f.configPath, f.keyPath, join(f.root, 'symlink.json')), { code: 'E_PATH' });
  await writeFile(join(f.root, 'app/leaked.txt'), await readFile(f.keyPath));
  f.config.include = ['index.html', 'leaked.txt']; await writeFile(f.configPath, JSON.stringify(f.config));
  await assert.rejects(pack(f.configPath, f.keyPath, join(f.root, 'private.json')), { code: 'E_PRIVATE' });
});

test('key generation and release output never overwrite existing files', async t => {
  const f = await fixture(t), initial = await readFile(f.keyPath, 'utf8');
  await assert.rejects(generateKeys(f.keyPath, f.publicPath), { code: 'EEXIST' });
  assert.equal(await readFile(f.keyPath, 'utf8'), initial);
  const secondPrivate = join(f.root, 'new.key.pem');
  await assert.rejects(generateKeys(secondPrivate, f.publicPath), { code: 'EEXIST' });
  await assert.rejects(readFile(secondPrivate), { code: 'ENOENT' });
  await assert.rejects(pack(f.configPath, f.keyPath, f.bundle), { code: 'EEXIST' });
});
