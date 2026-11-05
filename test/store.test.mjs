import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { activate, rollback, loadActive, stateAt } from '../src/store.mjs';
import { serve } from '../src/server.mjs';

test('failed activation leaves active state and the served app intact', async t => {
  const f = await fixture(t); await activate(f.bundle, f.store, f.key);
  const before = await stateAt(f.store), value = structuredClone(f.release.envelope);
  value.assets[0].data = Buffer.from('corrupted').toString('base64');
  const bad = join(f.root, 'bad.json'); await writeFile(bad, JSON.stringify(value));
  await assert.rejects(activate(bad, f.store, f.key)); assert.deepEqual(await stateAt(f.store), before);
  assert.equal((await loadActive(f.store, f.key)).files.get('index.html').toString(), '<h1>First release</h1>');
});

test('higher-sequence updates hot-load; explicit rollback retains a downgrade barrier', async t => {
  const f = await fixture(t); await activate(f.bundle, f.store, f.key);
  const server = await serve({ store: f.store, key: f.key, port: 0 }); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(origin)).text(), '<h1>First release</h1>');
  const next = await f.next(); await activate(next, f.store, f.key);
  assert.equal(await (await fetch(origin)).text(), '<h1>Second release</h1>');
  await rollback(f.store, f.key);
  assert.equal(await (await fetch(origin)).text(), '<h1>First release</h1>');
  assert.equal((await stateAt(f.store)).highWater, 2);
  await assert.rejects(activate(next, f.store, f.key), { code: 'E_DOWNGRADE' });
  const third = await f.next(3); await activate(third, f.store, f.key);
  assert.equal((await loadActive(f.store, f.key)).manifest.sequence, 3);
});

test('stores pin project and trust key; concurrent writers cannot silently replace state', async t => {
  const f = await fixture(t); await activate(f.bundle, f.store, f.key);
  const next = await f.next();
  const results = await Promise.allSettled([activate(next, f.store, f.key), activate(next, f.store, f.key)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'E_BUSY');
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(loadActive(f.store, other), { code: 'E_TRUST' });
  f.config.project.id = 'other-project'; const third = await f.next(3);
  await assert.rejects(activate(third, f.store, f.key), { code: 'E_PROJECT' });
});

test('mirror serves verified memory, exposes no state files, rejects writes and fails closed on invalid activation state', async t => {
  const f = await fixture(t); await activate(f.bundle, f.store, f.key);
  const server = await serve({ store: f.store, key: f.key, port: 0 }); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/active.json', '/publisher.key.pem', '/.env', '/__evolve/../../state/active.json', '/%2fetc%2fpasswd']) assert.equal((await fetch(origin + path)).status, 404);
  assert.equal((await fetch(origin, { method: 'POST', body: 'untrusted' })).status, 405);
  const response = await fetch(origin); assert.match(response.headers.get('Content-Security-Policy'), /object-src 'none'/); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const metadata = await (await fetch(origin + '/.well-known/evolve-hosting.json')).json(); assert.equal(metadata.releaseId, f.release.id);
  const state = await stateAt(f.store); state.fingerprint = 'wrong'; await writeFile(join(f.store, 'active.json'), JSON.stringify(state));
  assert.equal((await fetch(origin)).status, 503);
});

test('static export verifies before writing and never replaces an existing directory', async t => {
  const { exportStatic } = await import('../src/export.mjs');
  const f = await fixture(t), output = join(f.root, 'static');
  await exportStatic(f.bundle, f.key, output);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<h1>First release</h1>');
  const metadata = JSON.parse(await readFile(join(output, '.well-known/evolve-hosting.json'), 'utf8'));
  assert.equal(metadata.releaseId, f.release.id);
  assert.ok((await readFile(join(output, '__evolve/app.js'))).length > 0);
  await assert.rejects(exportStatic(f.bundle, f.key, output), { code: 'E_EXISTS' });
  const bad = join(f.root, 'bad.json'), corrupt = structuredClone(f.release.envelope); corrupt.signature = 'A'.repeat(86) + '==';
  await writeFile(bad, JSON.stringify(corrupt));
  await assert.rejects(exportStatic(bad, f.key, join(f.root, 'never-published')));
  await assert.rejects(readFile(join(f.root, 'never-published/index.html')), { code: 'ENOENT' });
});
