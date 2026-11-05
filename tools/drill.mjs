import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { activate, loadActive } from '../src/store.mjs';
import { verifyBundle } from '../src/release.mjs';
const root = await mkdtemp(join(tmpdir(), 'evolve-hosting-drill-')), children = [];
const keyPath = resolve('public/publisher.pub.pem'), bundlePath = resolve('public/demo.release.json');
const key = await readFile(keyPath, 'utf8'), bundle = await readFile(bundlePath), release = verifyBundle(bundle, key);
const rounded = value => Math.round(value * 100) / 100;
async function launch(store) {
  const child = spawn(process.execPath, ['bin/evolve-hosting.mjs', 'serve', '--key', keyPath, '--store', store, '--port', '0', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const line = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Mirror startup timed out')); }, 10_000);
    const finish = fn => value => { clearTimeout(timer); fn(value); };
    line.once('line', finish(value => { const result = JSON.parse(value); if (!result.ok) reject(Error('Mirror startup failed')); else resolve(result); }));
    child.once('error', finish(reject)); child.once('exit', finish(() => reject(Error('Mirror exited before ready'))));
  });
  line.close(); return { child, origin: `http://127.0.0.1:${ready.address.port}` };
}
try {
  const stores = [join(root, 'operator-a'), join(root, 'operator-b')];
  const activationStart = performance.now();
  for (const store of stores) await activate(bundlePath, store, key);
  const activationMs = performance.now() - activationStart;
  const [a, b] = await Promise.all(stores.map(launch));
  const first = await fetch(a.origin), second = await fetch(b.origin);
  if (await first.text() !== await second.text()) throw Error('Mirrors differ');
  const bad = structuredClone(release.envelope); bad.assets[0].data = Buffer.from('tampered').toString('base64');
  const badPath = join(root, 'corrupt.json'); await writeFile(badPath, JSON.stringify(bad));
  let rejected = false;
  try { await activate(badPath, stores[0], key); } catch (error) { rejected = error.code === 'E_INTEGRITY'; }
  if (!rejected || (await loadActive(stores[0], key)).id !== release.id) throw Error('Failed activation changed live release');
  const stopped = once(a.child, 'exit'); a.child.kill('SIGTERM'); await stopped;
  const failStart = performance.now(); let offline = false;
  try { await fetch(a.origin, { signal: AbortSignal.timeout(2000) }); } catch { offline = true; }
  const failedProbeMs = performance.now() - failStart;
  const backupStart = performance.now();
  const metadata = await (await fetch(b.origin + '/.well-known/evolve-hosting.json')).json();
  const backupProbeMs = performance.now() - backupStart;
  if (!offline || metadata.releaseId !== release.id) throw Error('Recovery drill failed');
  const report = {
    schema: 'evolve-hosting.drill.v1', at: new Date().toISOString(), node: process.version,
    scope: 'Two independent Node CLI processes on loopback, separate mirror stores; no DNS changes or production outages.',
    releaseId: release.id, publisherFingerprint: release.fingerprint, files: release.files.size,
    publicBytes: release.manifest.files.reduce((n, f) => n + f.size, 0),
    checks: { independentProcesses: true, identicalAppResponses: true, corruptUpdateRejected: true, priorReleasePreserved: true, stoppedMirrorUnreachable: true, remainingMirrorReportsSameRelease: true },
    timingsMs: { activateTwoStores: rounded(activationMs), failedMirrorProbe: rounded(failedProbeMs), remainingMirrorProbe: rounded(backupProbeMs) },
    cost: { paidResourcesProvisioned: false, cloudOperations: false, note: 'Existing local machine supplied CPU and storage. This drill does not measure worldwide availability, DNS recovery or production hosting expense.' },
  };
  await mkdir('docs', { recursive: true }); await writeFile('docs/drill-report.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(children.filter(child => child.exitCode === null && !child.killed).map(async child => { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }));
  await rm(root, { recursive: true, force: true });
}
