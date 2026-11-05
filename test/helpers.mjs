import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeys, pack } from '../src/release.mjs';
export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'evolve-hosting-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyPath = join(root, 'publisher.key.pem'), publicPath = join(root, 'publisher.pub.pem');
  await generateKeys(keyPath, publicPath); const key = await readFile(publicPath, 'utf8');
  await mkdir(join(root, 'app'));
  const config = JSON.parse(await readFile(new URL('../examples/commons/hosting.json', import.meta.url), 'utf8'));
  config.root = 'app'; config.include = ['index.html']; config.mirrors = [];
  await writeFile(join(root, 'app/index.html'), '<h1>First release</h1>');
  const configPath = join(root, 'hosting.json'), bundle = join(root, 'first.evolve.json');
  await writeFile(configPath, JSON.stringify(config));
  const release = await pack(configPath, keyPath, bundle);
  return { root, keyPath, publicPath, key, configPath, config, bundle, release, store: join(root, 'state'), async next(sequence = 2, content = '<h1>Second release</h1>') {
    config.sequence = sequence; config.version = `0.${sequence}.0`;
    await writeFile(configPath, JSON.stringify(config)); await writeFile(join(root, 'app/index.html'), content);
    const path = join(root, `next-${sequence}.json`); await pack(configPath, keyPath, path); return path;
  } };
}
