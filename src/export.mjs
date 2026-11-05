import { mkdir, mkdtemp, chmod, writeFile, copyFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readBounded, verifyBundle } from './release.mjs';
import { mirrorMetadata, securityHeaders } from './server.mjs';
import { HostingError } from './protocol.mjs';
/** Verify everything before writing; activate a complete static tree by rename. */
export async function exportStatic(bundlePath, key, destination) {
  const release = verifyBundle(await readBounded(bundlePath), key), output = resolve(destination);
  try { await lstat(output); throw new HostingError('E_EXISTS', 'Export destination already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(resolve(dirname(output), '.evolve-export-'));
  try {
    const write = async (path, data) => { const target = resolve(staging, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, data, { mode: 0o644 }); };
    for (const [path, bytes] of release.files) await write(path, bytes);
    await write('.well-known/evolve-hosting.json', JSON.stringify(mirrorMetadata(release)) + '\n');
    await write('__evolve/release.json', release.bytes); await write('__evolve/publisher.pub.pem', key);
    for (const name of ['index.html', 'app.js', 'style.css', 'THIRD-PARTY-LICENSES.txt']) {
      let content = await readBounded(new URL('../public/' + name, import.meta.url));
      if (name === 'index.html') content = content.toString('utf8').replace('href="./example/" id="open-example"', 'href="../" id="open-example"');
      await write('__evolve/' + name, content);
    }
    await write('_headers', '/*\n' + Object.entries({ ...securityHeaders, 'Access-Control-Allow-Origin': '*' }).map(([name, value]) => `  ${name}: ${value}`).join('\n') + '\n');
    await chmod(staging, 0o755); await rename(staging, output);
  } finally { await rm(staging, { recursive: true, force: true }); }
  return { id: release.id, files: release.files.size, output };
}
