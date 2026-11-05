/** Shared, platform-independent v1 wire rules. All limits are checked before activation. */
export const LIMITS = Object.freeze({ bundle: 24_000_000, total: 16_000_000, file: 4_000_000, files: 512 });
export class HostingError extends Error {
  constructor(code, message) { super(message); this.name = 'HostingError'; this.code = code; }
}
export const requireThat = (ok, code, message) => { if (!ok) throw new HostingError(code, message); };
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  requireThat(value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isSafeInteger(value), 'E_SCHEMA', 'Unsupported JSON value.');
  return JSON.stringify(value);
}
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const exact = (value, names) => {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','), 'E_SCHEMA', 'Unexpected or missing object fields.');
};
export function safePath(path) {
  requireThat(typeof path === 'string' && path.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) &&
    path.split('/').every((s) => s && s !== '.' && s !== '..' && !s.startsWith('.')) &&
    !/(^|\/)(?:private|secrets?|credentials?|node_modules|vendor|netlify|bin|tools|test)(\/|$)/i.test(path) &&
    /\.(?:html|css|js|mjs|wasm|json|svg|png|jpe?g|webp|gif|ico|woff2?|txt|mp3|mp4|webm)$/i.test(path), 'E_PATH', 'Only public static asset paths are accepted.');
  return path;
}
export function publicURL(value, { loopback = false } = {}) {
  let url; try { url = new URL(value); } catch { throw new HostingError('E_URL', 'A complete HTTPS URL is required.'); }
  requireThat(!url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || loopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'E_URL', 'Use HTTPS; HTTP is allowed only for explicit loopback mirrors.');
  return url;
}
export function validateManifest(m) {
  exact(m, ['schema', 'project', 'version', 'sequence', 'createdAt', 'files', 'mirrors', 'support', 'backends']);
  requireThat(m.schema === 'evolve-hosting.release.v1', 'E_SCHEMA', 'Unsupported release schema.');
  exact(m.project, ['id', 'name', 'description']);
  requireThat(id(m.project.id) && text(m.project.name, 80) && text(m.project.description, 320), 'E_SCHEMA', 'Invalid project identity.');
  requireThat(text(m.version, 40) && Number.isSafeInteger(m.sequence) && m.sequence > 0 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.createdAt) && Number.isFinite(Date.parse(m.createdAt)), 'E_SCHEMA', 'Invalid version, sequence or timestamp.');
  requireThat(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= LIMITS.files, 'E_LIMIT', 'Invalid asset count.');
  let total = 0; const paths = new Set();
  for (const file of m.files) {
    exact(file, ['path', 'size', 'sha256']); safePath(file.path);
    requireThat(!paths.has(file.path.toLowerCase()) && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= LIMITS.file, 'E_SCHEMA', 'Invalid or duplicate asset.');
    paths.add(file.path.toLowerCase()); total += file.size;
  }
  requireThat(m.files.some(f => f.path === 'index.html') && total <= LIMITS.total, 'E_LIMIT', 'A bounded release must include index.html.');
  requireThat(Array.isArray(m.mirrors) && m.mirrors.length <= 12, 'E_SCHEMA', 'Too many mirrors.');
  for (const mirror of m.mirrors) {
    exact(mirror, ['name', 'url']); requireThat(text(mirror.name, 80), 'E_SCHEMA', 'Invalid mirror name.');
    const url = publicURL(mirror.url, { loopback: true }); requireThat(url.pathname.endsWith('/'), 'E_URL', 'Mirror URL must end in /.');
  }
  requireThat(Array.isArray(m.backends) && m.backends.length <= 12, 'E_SCHEMA', 'Invalid backend dependencies.');
  for (const b of m.backends) {
    exact(b, ['name', 'url', 'purpose']); requireThat(text(b.name, 80) && text(b.purpose, 240), 'E_SCHEMA', 'Invalid backend description.'); publicURL(b.url);
  }
  exact(m.support, ['fairgroundURL', 'recipients']);
  requireThat(m.support.fairgroundURL === 'https://www.evolvetech.dev/play/fairground/#/about' || m.support.fairgroundURL === './fairground/#/about', 'E_URL', 'Use the reviewed Fairground support entry.');
  requireThat(Array.isArray(m.support.recipients) && m.support.recipients.length <= 12, 'E_SCHEMA', 'Invalid support recipients.');
  const recipients = new Set();
  for (const r of m.support.recipients) {
    exact(r, ['id', 'name', 'role', 'address', 'reviewed', 'origin']);
    requireThat(id(r.id) && !recipients.has(r.id) && text(r.name, 80) && ['development', 'hosting'].includes(r.role) && /^[A-Z2-7]{58}$/.test(r.address) && r.reviewed === true, 'E_SCHEMA', 'Only publisher-reviewed recipients are accepted.');
    publicURL(r.origin); recipients.add(r.id);
  }
  return m;
}
export function parseEnvelope(value) {
  exact(value, ['schema', 'manifest', 'signature', 'assets']);
  requireThat(value.schema === 'evolve-hosting.bundle.v1', 'E_SCHEMA', 'Unsupported bundle schema.');
  validateManifest(value.manifest);
  requireThat(typeof value.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value.signature), 'E_SIGNATURE', 'Invalid signature encoding.');
  requireThat(Array.isArray(value.assets) && value.assets.length === value.manifest.files.length, 'E_SCHEMA', 'Asset count does not match manifest.');
  for (let i = 0; i < value.assets.length; i++) {
    const asset = value.assets[i]; exact(asset, ['path', 'data']);
    requireThat(asset.path === value.manifest.files[i].path && typeof asset.data === 'string' && asset.data.length <= Math.ceil(LIMITS.file / 3) * 4 && asset.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(asset.data), 'E_SCHEMA', 'Asset encoding or ordering is invalid.');
  }
  return value;
}
