# Evolve Hosting

Publish a signed static application, run independent mirrors, and support its development and hosting through Fairground's direct payment rail. Browser apps can use JavaScript or WASM; this tool distributes their public files without requiring a central application server.

[Open the workspace](https://www.evolvetech.dev/play/evolve-hosting/) · [Try Commons Board](https://www.evolvetech.dev/play/evolve-hosting/example/) · [Project notes](https://www.evolvetech.dev/projects/evolve-hosting/)

**Early release.** The CLI, browser verifier, static export, mirror server, rollback and external-wallet support flow work. The two published example copies use EvolveTech's existing Netlify and Bunny providers. Community operators are welcome; none are claimed to be participating yet. The recorded recovery drill uses two independent local Node processes, not a global hosting network.

## Run a mirror

Node **22.18 or later** is required. No provider account, wallet, donation or cloud provisioning is required to run a local mirror.

```sh
git clone https://github.com/anthony-firn/evolve-hosting.git
cd evolve-hosting
npm ci
npm run build
node bin/evolve-hosting.mjs verify --bundle public/demo.release.json --key public/publisher.pub.pem --json
node bin/evolve-hosting.mjs activate --bundle public/demo.release.json --key public/publisher.pub.pem --store .state/mirror
node bin/evolve-hosting.mjs serve --key public/publisher.pub.pem --store .state/mirror
```

Open **http://127.0.0.1:4198/** for the app and **http://127.0.0.1:4198/__evolve/** for the release, mirrors and support panel. Each operator uses their own store; specify `--port 4200 --store .state/another-mirror` to run a second one. The server binds to loopback by default. Public operators explicitly bind their chosen interface with `--host` and configure their own HTTPS reverse proxy and resource limits.

Obtain the trust key independently of an arbitrary mirror. For this published example, compare the key in a trusted copy of this GitHub repository or release with this SHA-256 fingerprint:

```text
16cca6ccea13a6058327da453aa583a1145ba6e994be36859f7e0fd70ecbdcbc
```

Downloading a bundle and its key from the same untrusted page is not independent verification. The browser verifier is a convenience on a trusted bootstrap; it does not make an untrusted origin safe.

## Export to any static host

```sh
node bin/evolve-hosting.mjs export --bundle public/demo.release.json --key public/publisher.pub.pem --out dist/my-mirror
```

Upload that complete directory to your own static hosting provider. It includes the app, a mirror/support panel, public metadata and the signed bundle. Export verifies first, stages a complete tree, and refuses to replace an existing destination. Netlify-style `_headers` are included; other hosts need equivalent CSP, MIME, no-store and public metadata CORS settings. Hosts serving under a path must preserve the directory layout. Configure CORS for public metadata if other origins should check it. No state or signing key is exported.

## Publish your own app

```sh
mkdir -p .private
node bin/evolve-hosting.mjs keygen --private .private/my-project.key.pem --public .private/my-project.pub.pem
node bin/evolve-hosting.mjs pack --config examples/commons/hosting.json --key .private/my-project.key.pem --out dist/my-release.evolve.json
node bin/evolve-hosting.mjs verify --bundle dist/my-release.evolve.json --key .private/my-project.pub.pem
```

The configuration is an example: edit the project identity, root, explicit asset list, mirrors, backend dependencies and reviewed support recipients for your application before publishing it. `root` resolves relative to the configuration file. Use `recipients: []` until you have reviewed and authorized payout entries. Never copy another project's recipient configuration unintentionally. Share only the public key through an independent trusted channel. Keep signing keys backed up privately; they are created with mode 0600, excluded by `.gitignore`, and never printed by the CLI.

Files are signed as an immutable release manifest, using Ed25519 and SHA-256. Every new release needs a strictly increasing integer `sequence`, including a rebuild with changed metadata. The human-readable `version` does not determine update order. Release limits are 512 assets, 4 MB per asset, 16 MB total and a 24 MB JSON bundle. Hidden paths, traversal, symlinks, tooling/private directories, unsupported file extensions and PEM private key material are rejected. This is an explicit public-file allowlist, not a general secret scanner; review the selected bytes yourself.

The JSON/base64 bundle keeps import simple and avoids archive extraction. Large media, peer file transfer and IPFS/Blossom adapters are future work.

## Updates, rollback and diagnostics

```sh
node bin/evolve-hosting.mjs activate --bundle NEW_RELEASE.json --key TRUSTED_PUBLIC.pem --store .state/mirror
node bin/evolve-hosting.mjs rollback --key TRUSTED_PUBLIC.pem --store .state/mirror
node bin/evolve-hosting.mjs doctor --bundle public/demo.release.json --key public/publisher.pub.pem --json
node bin/evolve-hosting.mjs doctor --bundle public/demo.release.json --key public/publisher.pub.pem --check-mirrors --json
```

Activation verifies all files before changing a small active-state pointer. The previous release remains available for explicit rollback; the highest activated sequence is retained to reject replayed updates. The running Node mirror notices pointer changes. A store pins one project and trust key. No automatic key replacement or remote update installation occurs.

Doctor is offline unless `--check-mirrors` is passed. Network checks contact the signed mirror list, reject redirects and compare *reported* release identity; they do not attest to all HTML served by a remote operator. The public browser's checks have the same limitation. All commands support `--json`, nonzero failure exit codes, and safe errors without key material. `serve --json` prints one startup record and keeps running. See `node bin/evolve-hosting.mjs --help`.

## Donations through Fairground

New users can follow the [wallet setup walkthrough](https://www.evolvetech.dev/wallet-setup/) to save or restore an account, transfer ALGO without Meld, and check USDC readiness. No recovery credentials belong on that public guide.

The browser uses pinned, Apache-licensed [Fairground payment rail code](vendor/fairground/SOURCE.json), rather than a new payment processor. A donor explicitly selects recipients and amounts, readiness is checked on Algorand mainnet, and an ARC-26 link opens the donor's external wallet. Each payment goes directly to its recipient in native USDC on Algorand. A unique public note binds it to the project, recipient and payment session.

The donor pastes a transaction ID to confirm it. The checker requires the correct network, asset, recipient, **exact** amount, unique note and confirmation window. Used IDs cannot satisfy another payment in that confirmation session. Split payments remain separate wallet actions; partial completion is possible. The application never signs a transaction, stores wallet keys, pools funds, or automatically retries payments. No card/bank checkout or automatic hosting rewards are included. An existing link opens Fairground's full support flow separately.

Support entries are reviewed by the publisher and signed into the release. This is not automatic proof of an HTTP operator's ownership, service or expenses. There are no community operators in the example's payout list. The EvolveTech development fund was checked on 2026-11-04 local time and **was not opted in to receive USDC**. The UI checks again before offering payment links and refuses unavailable recipients. Fund activation requires its owner's ALGO setup and USDC opt-in; no money was moved during development.

## Cost model

A static app can run on existing machines or free-tier capacity within provider limits. Operators still pay for bandwidth, storage, power and maintenance. Domain registration, optional providers and blockchain fees are separate costs. Donations are voluntary support, not guaranteed operator revenue or a service-level agreement.

This release added no paid cloud resources or new hosting subscriptions. The public demo uses EvolveTech's existing providers; this does not make those providers free. No production billing total or zero-cost-at-scale claim is made. [Operations and costs](docs/operations.md) separates the local drill, the existing provider deployments and future community participation.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run drill
```

Tests cover wrong signers, corrupted assets, path and size limits, private material, safe activation, concurrent writers, rollback/downgrade handling, exports, CLI JSON, mirror errors and payment matching. Playwright exercises desktop/mobile, browser verification, safe rendering, failed mirrors, split donation fixtures and the working browser-only app. No wallet opens and no payment is sent in tests. `npm run drill` starts **two separate Node CLI processes** with separate stores, stops one, verifies the other and records timings in [the drill report](docs/drill-report.json).

[Security and protocol](docs/security.md) · [Operations and cost record](docs/operations.md)

Apache License 2.0. Copyright 2026 Anthony Firn. Fairground source and license provenance are included under `vendor/fairground/`.

Browser verification requires a modern browser with WebCrypto Ed25519 support. If unavailable, use the Node CLI with an independently trusted public key.
