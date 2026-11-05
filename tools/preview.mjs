import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { securityHeaders } from '../src/server.mjs';
const root = resolve('public');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(root + sep)) throw Error();
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', pem: 'text/plain' };
    res.writeHead(200, { ...securityHeaders, 'Content-Type': types[path.split('.').at(-1)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
server.listen(4199, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4199'));
