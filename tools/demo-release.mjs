import { mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { generateKeys, pack, verifyBundle } from '../src/release.mjs';
const privatePath = '.private/publisher.key.pem', publicPath = 'public/publisher.pub.pem', output = 'public/demo.release.json';
try {
  const release = verifyBundle(await readFile(output), await readFile(publicPath));
  console.log(JSON.stringify({ ok: true, existing: true, releaseId: release.id }));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await mkdir('.private', { recursive: true, mode: 0o700 });
  try { await access(privatePath); } catch { await generateKeys(privatePath, publicPath); }
  const release = await pack('examples/commons/hosting.json', privatePath, output);
  console.log(JSON.stringify({ ok: true, releaseId: release.id, fingerprint: release.fingerprint }));
}
