#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { generateKeys, pack, readBounded, verifyBundle } from '../src/release.mjs';
import { activate, rollback } from '../src/store.mjs';
import { serve } from '../src/server.mjs';
import { exportStatic } from '../src/export.mjs';
import { doctor } from '../src/doctor.mjs';
import { HostingError } from '../src/protocol.mjs';
const usage = `Evolve Hosting — Node 22.18+
keygen   --private PATH --public PATH
pack     --config PATH --key PRIVATE_KEY --out PATH
verify   --bundle PATH --key PUBLIC_KEY
export   --bundle PATH --key PUBLIC_KEY --out NEW_DIRECTORY
activate --bundle PATH --key PUBLIC_KEY --store PATH
rollback --key PUBLIC_KEY --store PATH
serve    --key PUBLIC_KEY --store PATH [--host 127.0.0.1] [--port 4198]
doctor   --bundle PATH --key PUBLIC_KEY [--check-mirrors]
All commands accept --json. No command provisions cloud services, changes DNS or sends payments.
Default serving is loopback-only; use a trusted HTTPS reverse proxy for public access.`;
const args = process.argv.slice(2), json = args.includes('--json');
const output = (value) => console.log(json ? JSON.stringify(value) : Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
try {
  if (!args.length || args.includes('--help')) { console.log(json ? JSON.stringify({ ok: true, usage }) : usage); }
  else {
    const command = args.shift();
    const options = Object.fromEntries(['private', 'public', 'config', 'key', 'out', 'bundle', 'store', 'host', 'port'].map((k) => [k, { type: 'string' }]));
    options.json = { type: 'boolean' }; options['check-mirrors'] = { type: 'boolean' };
    const { values } = parseArgs({ args, options });
    const allowed = { keygen: ['private', 'public'], pack: ['config', 'key', 'out'], verify: ['bundle', 'key'], export: ['bundle', 'key', 'out'], activate: ['bundle', 'key', 'store'], rollback: ['key', 'store'], serve: ['key', 'store', 'host', 'port'], doctor: ['bundle', 'key', 'check-mirrors'] };
    if (!allowed[command] || Object.keys(values).some((v) => v !== 'json' && !allowed[command].includes(v))) throw new HostingError('E_ARGS', 'Unknown command or option. Run --help.');
    const required = allowed[command].filter((v) => !['host', 'port', 'check-mirrors'].includes(v));
    if (required.some((v) => !values[v])) throw new HostingError('E_ARGS', 'Missing required option. Run --help.');
    if (command === 'keygen') output({ ok: true, ...await generateKeys(values.private, values.public) });
    if (command === 'pack') { const r = await pack(values.config, values.key, values.out); output({ ok: true, releaseId: r.id, fingerprint: r.fingerprint, files: r.files.size, bytes: r.manifest.files.reduce((n, f) => n + f.size, 0) }); }
    if (['verify', 'export', 'activate', 'rollback', 'doctor', 'serve'].includes(command)) {
      const key = await readBounded(values.key, 16_000);
      if (command === 'verify') { const r = verifyBundle(await readBounded(values.bundle), key); output({ ok: true, releaseId: r.id, fingerprint: r.fingerprint, files: r.files.size }); }
      if (command === 'export') output({ ok: true, ...await exportStatic(values.bundle, key, values.out) });
      if (command === 'activate') output({ ok: true, ...await activate(values.bundle, values.store, key) });
      if (command === 'rollback') output({ ok: true, ...await rollback(values.store, key) });
      if (command === 'doctor') { const result = await doctor({ bundle: values.bundle, key, checkMirrors: !!values['check-mirrors'] }); output(result); if (!result.ok) process.exitCode = 1; }
      if (command === 'serve') {
        const port = values.port === undefined ? 4198 : Number(values.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new HostingError('E_ARGS', 'Port must be an integer from 0 to 65535.');
        const server = await serve({ store: values.store, key, host: values.host || '127.0.0.1', port });
        output({ ok: true, schema: 'evolve-hosting.server.v1', address: server.address(), portal: '/__evolve/' });
        for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
      }
    }
  }
} catch (error) {
  const known = error instanceof HostingError;
  output({ ok: false, error: { code: known ? error.code : error.code === 'EEXIST' ? 'E_EXISTS' : error.code?.startsWith('ERR_PARSE_ARGS') ? 'E_ARGS' : 'E_IO', message: known ? error.message : 'Operation failed. Check arguments, existing files, permissions and input formats.' } });
  process.exitCode = 1;
}
