import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { verifyBundle } from '../src/release.mjs';
import { exportStatic } from '../src/export.mjs';
await mkdir('public', { recursive: true });
await build({ entryPoints: ['web/app.mjs'], outfile: 'public/app.js', bundle: true, format: 'esm', target: ['es2022'], minify: true, legalComments: 'eof' });
const licenses = await Promise.all(['NOTICE', 'vendor/fairground/LICENSE', 'node_modules/@noble/hashes/LICENSE', 'node_modules/@scure/base/LICENSE'].map(async path => `\n=== ${path} ===\n` + await readFile(path, 'utf8')));
await writeFile('public/THIRD-PARTY-LICENSES.txt', licenses.join('\n'));
for (const name of ['index.html', 'style.css']) await copyFile('web/' + name, 'public/' + name);
// A fresh clone can build and mirror the already-published signed example without a private key.
const key = await readFile('public/publisher.pub.pem', 'utf8');
const release = verifyBundle(await readFile('public/demo.release.json'), key);
await rm('public/example', { recursive: true, force: true });
await exportStatic('public/demo.release.json', key, 'public/example');
console.log(`Built public workspace and verified example mirror: ${release.id}`);
