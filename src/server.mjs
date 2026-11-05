import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadActive, stateAt } from './store.mjs';
import { safePath } from './protocol.mjs';
export const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', wasm: 'application/wasm', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2' };
export function mirrorMetadata(active) {
  return { schema: 'evolve-hosting.mirror.v1', releaseId: active.id, fingerprint: active.fingerprint, manifest: active.manifest };
}
export async function serve({ store, key, host = '127.0.0.1', port = 4198 }) {
  let active = await loadActive(store, key);
  const server = createServer(async (req, res) => {
    const send = (status, bytes, type, extra = {}) => {
      res.writeHead(status, { ...securityHeaders, 'Content-Type': type, ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
      const state = await stateAt(store);
      if (state?.current !== active.id || state?.fingerprint !== active.fingerprint) active = await loadActive(store, key);
      let path;
      try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, 'Invalid path', 'text/plain'); }
      if (path === '/.well-known/evolve-hosting.json') return send(200, JSON.stringify(mirrorMetadata(active)), 'application/json', { 'Access-Control-Allow-Origin': '*' });
      if (path === '/__evolve/release.json') return send(200, active.bytes, 'application/json', { 'Access-Control-Allow-Origin': '*' });
      if (path === '/__evolve/publisher.pub.pem') return send(200, key, 'text/plain', { 'Access-Control-Allow-Origin': '*' });
      if (path.startsWith('/__evolve/')) {
        const name = path.slice('/__evolve/'.length) || 'index.html';
        if (!['index.html', 'app.js', 'style.css', 'THIRD-PARTY-LICENSES.txt'].includes(name)) return send(404, 'Not found', 'text/plain');
        let content = await readFile(fileURLToPath(new URL('../public/' + name, import.meta.url)));
        if (name === 'index.html') content = content.toString('utf8').replace('href="./example/" id="open-example"', 'href="../" id="open-example"');
        return send(200, content, types[name.split('.').at(-1)]);
      }
      if (path === '/__evolve') return send(308, '', 'text/plain', { Location: '/__evolve/' });
      const asset = path === '/' ? 'index.html' : path.slice(1);
      try { safePath(asset); } catch { return send(404, 'Not found', 'text/plain'); }
      const data = active.files.get(asset);
      if (!data) return send(404, 'Not found', 'text/plain');
      send(200, data, types[asset.split('.').at(-1).toLowerCase()] || 'application/octet-stream');
    } catch { send(503, 'Mirror could not load a verified release. Retry after an operator checks its state.', 'text/plain'); }
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000; server.keepAliveTimeout = 1000; server.maxHeadersCount = 64;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}
