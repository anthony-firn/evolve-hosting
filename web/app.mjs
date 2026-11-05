import { verifyBrowser, boundedText } from '../src/browser.mjs';
import { LIMITS } from '../src/protocol.mjs';
import { algorandUsdc, donationPlan, prepareDonation, fetchDonationReceipt } from '../src/support.mjs';
const $ = (id) => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const bytes = (n) => n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} KB`;
const commands = `node bin/evolve-hosting.mjs verify --bundle release.evolve.json --key publisher.pub.pem
node bin/evolve-hosting.mjs activate --bundle release.evolve.json --key publisher.pub.pem --store .state/mirror
node bin/evolve-hosting.mjs serve --key publisher.pub.pem --store .state/mirror`;
$('commands').textContent = commands;
let active = null, candidate = null, verifyVersion = 0, planVersion = 0, used = new Set();
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const message = (error) => error?.code ? error.message : 'Could not complete this operation. Check the input or connection and try again.';
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function verify(text, pem) {
  const version = ++verifyVersion; $('verify').disabled = true;
  try {
    const release = await verifyBrowser(text, pem);
    if (version !== verifyVersion) return;
    active = release; used = new Set(); planVersion++;
    render(release); notice('Signature and every public asset verified against the supplied publisher key.');
  } catch (error) { if (version === verifyVersion) notice(message(error) + (active ? ' The previous verified release remains displayed.' : ''), true); }
  finally { if (version === verifyVersion) $('verify').disabled = false; }
}
function render(release) {
  const m = release.manifest;
  $('version').textContent = m.version; $('file-count').textContent = m.files.length;
  $('size').textContent = bytes(m.files.reduce((n, f) => n + f.size, 0)); $('backend-count').textContent = m.backends.length;
  $('project').textContent = m.project.name; $('description').textContent = m.project.description;
  $('release-hash').textContent = release.id; $('fingerprint').textContent = release.fingerprint; $('verified').textContent = 'Bundle verified';
  $('download').disabled = false; $('download-key').disabled = false; $('check-mirrors').disabled = false;
  $('assets').replaceChildren(...m.files.map((f) => { const item = el('li'); item.append(el('span', f.path), el('span', bytes(f.size))); item.title = f.sha256; return item; }));
  $('mirror-list').replaceChildren(...m.mirrors.map((mirror) => {
    const row = el('div', undefined, 'mirror'), link = el('a', mirror.name + ' ↗'); link.href = mirror.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    row.append(link, el('small', mirror.url), el('div', 'Not checked', 'status')); return row;
  }));
  if (!m.mirrors.length) $('mirror-list').append(el('p', 'No public mirrors are listed. You can still download and serve this release.'));
  $('backend-description').textContent = m.backends.length ? m.backends.map(b => `${b.name}: ${b.purpose} (${b.url})`).join(' · ') : 'This application has no declared backend. Its public files are sufficient to run it. Browser-local data belongs to each origin.';
  $('fairground').href = m.support.fairgroundURL;
  $('recipients').replaceChildren(...m.support.recipients.map((r) => {
    const row = el('div', undefined, 'recipient'), label = el('label'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.dataset.id = r.id;
    label.append(checkbox, document.createTextNode(r.name));
    const input = el('input'); input.type = 'text'; input.inputMode = 'decimal'; input.value = '5.00'; input.setAttribute('aria-label', `USDC amount for ${r.name}`); input.dataset.amount = r.id;
    row.append(label, el('p', r.address, 'address'), el('small', `${r.role} · Publisher-reviewed · ${new URL(r.origin).hostname}`), input);
    for (const control of [input, checkbox]) control.addEventListener('input', invalidatePayments);
    return row;
  }));
  $('operators').textContent = m.support.recipients.some(r => r.role === 'hosting') ? 'Hosting recipients are reviewed by this publisher. There are no traffic-based rewards.' : 'No community hosting recipients are listed yet. You can run a mirror without donating.';
  $('prepare').disabled = !m.support.recipients.length;
  invalidatePayments();
}
function invalidatePayments() { planVersion++; $('payments').replaceChildren(); $('payment-status').textContent = ''; }
$('verify').onclick = async () => {
  if (!candidate) return notice('Choose a release bundle before verifying.', true);
  await verify(candidate, $('key').value);
};
$('bundle').onchange = async (event) => {
  candidate = null;
  const file = event.target.files[0]; if (!file) return;
  if (file.size > LIMITS.bundle) return notice('The bundle exceeds the 24 MB import limit.', true);
  candidate = await file.text(); notice('File loaded locally. Verify it against your separately trusted public key.');
};
$('download').onclick = () => active && download(active.text, 'release.evolve.json', 'application/json');
$('download-key').onclick = () => active && download(active.pem, 'publisher.pub.pem', 'text/plain');
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(commands); $('copy').textContent = 'Copied'; } catch { $('copy').textContent = 'Select and copy the commands above'; } };
$('check-mirrors').onclick = async () => {
  const release = active; if (!release) return;
  $('check-mirrors').disabled = true;
  try {
    await Promise.all(release.manifest.mirrors.map(async (mirror, i) => {
      const row = $('mirror-list').children[i], state = row.querySelector('.status');
      state.textContent = 'Checking…';
      try {
        const result = JSON.parse(await boundedText(new URL('.well-known/evolve-hosting.json', mirror.url), 100_000));
        if (result.schema !== 'evolve-hosting.mirror.v1' || result.releaseId !== release.id || result.fingerprint !== release.fingerprint) throw Error();
        state.textContent = 'Reports this release'; state.classList.remove('error');
      } catch { state.textContent = 'Unavailable or reports a different release'; state.classList.add('error'); }
    }));
  } finally { $('check-mirrors').disabled = false; }
};
$('prepare').onclick = async () => {
  if (!active) return;
  const release = active, current = ++planVersion, amounts = {};
  $('prepare').disabled = true; $('payments').replaceChildren(); $('payment-status').textContent = 'Checking the selected recipients on Algorand mainnet…';
  try {
    for (const check of $('recipients').querySelectorAll('input[type=checkbox]:checked')) {
      const value = [...$('recipients').querySelectorAll('[data-amount]')].find(n => n.dataset.amount === check.dataset.id).value;
      if (!/^\d{1,4}(?:\.\d{1,6})?$/.test(value)) throw Error();
      const [whole, part = ''] = value.split('.'); amounts[check.dataset.id] = String(BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, '0')));
    }
    const plan = await prepareDonation(donationPlan(release.manifest, amounts));
    if (current !== planVersion || release !== active) return;
    $('payment-status').textContent = `Total: ${(Number(plan.total) / 1_000_000).toFixed(6)} USDC across ${plan.payments.length} explicit payment(s), plus wallet fees. Review each recipient before signing.`;
    for (const payment of plan.payments) {
      const card = el('div', undefined, 'payment'), link = el('a', `Open wallet: ${(Number(payment.amount) / 1_000_000).toFixed(6)} USDC`, 'wallet-link'); link.href = payment.link;
      const input = el('input'); input.type = 'text'; input.maxLength = 52; input.placeholder = 'Confirmed transaction ID'; input.setAttribute('aria-label', `Transaction ID for ${payment.name}`);
      const confirm = el('button', 'Check receipt'), result = el('p');
      confirm.onclick = async () => {
        if (current !== planVersion) return;
        confirm.disabled = true;
        try {
          await fetchDonationReceipt(payment, input.value.trim().toUpperCase(), used);
          if (current !== planVersion) return;
          result.textContent = 'Confirmed: asset, recipient, exact amount, unique note and time match this payment.';
          link.remove(); input.disabled = true;
        } catch (error) { result.textContent = message(error); confirm.disabled = false; }
      };
      card.append(el('strong', payment.name), el('p', payment.to), el('p', 'Public payment note: ' + payment.memo), link, el('p', 'After paying, paste the transaction ID. Opening a wallet link is not confirmation.'), input, confirm, result);
      $('payments').append(card);
    }
  } catch (error) { if (current === planVersion) $('payment-status').textContent = error?.code ? error.message : 'Select a recipient and enter a valid positive USDC amount. Nothing was charged.'; }
  finally { if (release === active) $('prepare').disabled = false; }
};
async function start() {
  try {
    const inPortal = location.pathname.includes('/__evolve/'), root = inPortal ? new URL('../', location.href) : new URL('./', location.href);
    if (inPortal) { $('open-example').href = root.href; $('open-example').textContent = 'Open this mirrored app →'; }
    const [bundle, key] = await Promise.all([
      boundedText(new URL(inPortal ? '__evolve/release.json' : 'demo.release.json', root)),
      boundedText(new URL(inPortal ? '__evolve/publisher.pub.pem' : 'publisher.pub.pem', root), 16_000),
    ]);
    $('key').value = key; candidate = bundle; await verify(bundle, key);
  } catch (error) { notice('Could not load the example. You can still import a release and public key below.', true); }
}
start();
