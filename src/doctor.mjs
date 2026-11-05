import { verifyBundle, readBounded } from './release.mjs';
import { publicURL } from './protocol.mjs';
export async function doctor({ bundle, key, checkMirrors = false, fetch: request = globalThis.fetch }) {
  const release = verifyBundle(await readBounded(bundle), key);
  const checks = [{ code: 'release', ok: true, message: 'Signature, asset hashes, paths and limits verified against supplied trust key.' }];
  if (checkMirrors) for (const mirror of release.manifest.mirrors) {
    try {
      const url = new URL('.well-known/evolve-hosting.json', publicURL(mirror.url, { loopback: true }));
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error();
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 256_000) throw Error(); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const metadata = JSON.parse(Buffer.concat(chunks).toString());
      const ok = metadata.schema === 'evolve-hosting.mirror.v1' && metadata.releaseId === release.id && metadata.fingerprint === release.fingerprint;
      checks.push({ code: 'mirror', name: mirror.name, ok, message: ok ? 'Endpoint reports matching release; this is not remote HTML attestation.' : 'Endpoint reports a different release or trust key.' });
    } catch { checks.push({ code: 'mirror', name: mirror.name, ok: false, message: 'Mirror unavailable, redirected or returned invalid metadata.' }); }
  }
  return { schema: 'evolve-hosting.doctor.v1', ok: checks.every((c) => c.ok), releaseId: release.id, fingerprint: release.fingerprint, checks, backendDependencies: release.manifest.backends, paymentsTested: false };
}
