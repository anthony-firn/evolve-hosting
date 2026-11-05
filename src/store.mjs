import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fingerprint, readBounded, readJSON, verifyBundle } from './release.mjs';
import { HostingError, requireThat } from './protocol.mjs';
const releasePath = (root, id) => {
  requireThat(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id), 'E_STATE', 'Invalid release identifier.');
  return join(root, 'releases', id + '.json');
};
export async function stateAt(root) {
  try { return await readJSON(join(root, 'active.json'), 4096); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function trust(state, key) {
  requireThat(state && state.schema === 'evolve-hosting.active.v1' && state.fingerprint === fingerprint(key), 'E_TRUST', 'Mirror state does not match the separately supplied trust key.');
}
export async function loadActive(root, key) {
  const state = await stateAt(root); trust(state, key);
  const active = verifyBundle(await readBounded(releasePath(root, state.current)), key);
  requireThat(active.id === state.current && active.manifest.project.id === state.project, 'E_STATE', 'Active release does not match mirror state.');
  return { ...active, state };
}
async function locked(root, action) {
  root = resolve(root); await mkdir(join(root, 'releases'), { recursive: true });
  let lock;
  try { lock = await open(join(root, 'update.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new HostingError('E_BUSY', 'Another update holds the mirror lock. Inspect stale locks after a crash.'); throw error; }
  try { return await action(root); }
  finally { await lock.close(); await rm(join(root, 'update.lock')); }
}
async function commit(root, state) {
  const temporary = join(root, '.active-' + randomUUID());
  try { await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, join(root, 'active.json')); }
  finally { await rm(temporary, { force: true }); }
}
export async function activate(bundlePath, root, key) {
  const candidate = verifyBundle(await readBounded(bundlePath), key);
  return locked(root, async (directory) => {
    const state = await stateAt(directory);
    if (state) {
      const current = await loadActive(directory, key);
      requireThat(current.manifest.project.id === candidate.manifest.project.id, 'E_PROJECT', 'A mirror store serves one project.');
      if (state.current === candidate.id) return { id: candidate.id, changed: false };
      requireThat(candidate.manifest.sequence > state.highWater, 'E_DOWNGRADE', 'Activation needs a higher sequence; use explicit rollback for the previous release.');
    }
    const path = releasePath(directory, candidate.id);
    try { await writeFile(path, candidate.bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireThat(verifyBundle(await readBounded(path), key).id === candidate.id, 'E_INTEGRITY', 'Stored release differs.');
    }
    await commit(directory, { schema: 'evolve-hosting.active.v1', project: candidate.manifest.project.id, fingerprint: candidate.fingerprint,
      current: candidate.id, previous: state?.current ?? null, highWater: candidate.manifest.sequence });
    return { id: candidate.id, changed: true };
  });
}
export async function rollback(root, key) {
  return locked(root, async (directory) => {
    const active = await loadActive(directory, key), state = active.state;
    requireThat(state.previous, 'E_STATE', 'There is no previous release.');
    const previous = verifyBundle(await readBounded(releasePath(directory, state.previous)), key);
    requireThat(previous.id === state.previous && previous.manifest.project.id === state.project, 'E_STATE', 'Previous release does not match state.');
    await commit(directory, { ...state, current: state.previous, previous: state.current });
    return { id: state.previous, highWater: state.highWater };
  });
}
