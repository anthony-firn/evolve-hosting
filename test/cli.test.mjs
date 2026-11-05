import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fixture } from './helpers.mjs';
import { doctor } from '../src/doctor.mjs';
const cli = args => {
  const result = spawnSync(process.execPath, [new URL('../bin/evolve-hosting.mjs', import.meta.url).pathname, ...args, '--json'], { encoding: 'utf8' });
  return { ...result, parsed: JSON.parse(result.stdout) };
};

test('CLI returns machine-readable success and safe errors without printing key material', async t => {
  const f = await fixture(t);
  const result = cli(['verify', '--bundle', f.bundle, '--key', f.publicPath]);
  assert.equal(result.status, 0); assert.equal(result.parsed.releaseId, f.release.id); assert.equal(result.parsed.ok, true);
  for (const args of [['unknown'], ['verify'], ['verify', '--bad-secret-option', 'private-token'], ['verify', '--bundle', f.bundle, '--key', 'private-token'], ['serve', '--key', f.publicPath, '--store', f.store, '--port', 'NaN']]) {
    const error = cli(args); assert.equal(error.status, 1); assert.equal(error.parsed.ok, false);
    assert.ok(!error.stdout.includes('private-token')); assert.ok(!error.stdout.includes('PRIVATE KEY')); assert.equal(error.stderr, '');
  }
});

test('doctor is offline by default and explicitly labels mirror metadata claims', async t => {
  const f = await fixture(t);
  f.config.mirrors = [{ name: 'Fixture', url: 'http://127.0.0.1:9999/' }];
  const next = await f.next();
  let calls = 0;
  const request = async () => { calls++; return Response.json({ schema: 'evolve-hosting.mirror.v1', releaseId: 'wrong', fingerprint: f.release.fingerprint }); };
  const offline = await doctor({ bundle: next, key: f.key, fetch: request }); assert.equal(calls, 0); assert.equal(offline.ok, true); assert.equal(offline.paymentsTested, false);
  const online = await doctor({ bundle: next, key: f.key, checkMirrors: true, fetch: request }); assert.equal(calls, 1); assert.equal(online.ok, false);
  assert.equal(online.checks[1].code, 'mirror');
  const unavailable = await doctor({ bundle: next, key: f.key, checkMirrors: true, fetch: async () => { throw Error('private failure detail'); } });
  assert.equal(unavailable.ok, false); assert.ok(!JSON.stringify(unavailable).includes('private failure detail'));
});
