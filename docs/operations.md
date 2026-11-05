# Operations and cost record

## Current deployment

The public workspace is at `/play/evolve-hosting/` on EvolveTech's existing primary and backup providers. `/play/evolve-hosting/example/` is a static export of Commons Board with its own inspection/support panel. Both provider copies have the same publisher and are operated by EvolveTech. Neither is evidence of an independent community contributor.

The CLI can serve the signed release on an operator's machine or export it for another static host. There is no publisher-controlled gateway required to serve the app after verification. Existing EvolveTech DNS and certificate tooling remains responsible for the canonical domain. The hosting project's first release does not replace that control plane or distribute the private inbox backend.

## Measured local recovery

Run `npm run drill` after `npm ci` and `npm run build`. It uses the public signed example, creates temporary stores, starts two separate CLI processes, checks their app responses, attempts a corrupted activation, stops one process, and checks the other. Temporary stores and processes are removed afterward. Read `drill-report.json` for the observed timings and release fingerprint.

This is a loopback drill. It measures process availability and request latency on one machine. It does not measure DNS propagation, public failover, network partitions between countries, free-tier sustainability or production uptime. Rerunning replaces the local report with a new observation; CI does not silently update the committed record.

## Cost inventory

| Resource | Supplier / owner | Evidence in this release |
| --- | --- | --- |
| Local drill CPU and storage | Existing development machine | No paid resources provisioned; local process timings recorded. |
| Public static workspace and examples | Existing Netlify and Bunny deployments | Reuses already configured website infrastructure. Their bills are not measured by this project. |
| DNS and registration | Existing EvolveTech domain setup | Existing expense; no new domain purchased. |
| Community mirror capacity | Future independent operators | No participating operators or donated capacity claimed yet. |
| Optional direct support | Donor and recipient wallets; public Algorand infrastructure | Fixtures tested without real transfers. Actual network fees depend on the donor's wallet/network. |
| Development fund readiness | Existing EvolveTech recipient | Public read on 2026-11-04 local time found no receiving USDC holding. UI rechecks before preparing links. |

Near-zero **required publisher cost** is a design target for small static applications using contributed or existing capacity. Storage, bandwidth, electricity and maintenance still have suppliers. Optional donations do not guarantee recovery, retention, or revenue. Record actual bills and contributed capacity before publishing a numerical monthly-cost claim. Provider pricing and free limits can change; no automatic spending or provider account creation is included.

## Runbook

1. Obtain a reviewed release and independently trusted public key. Run offline `verify` and inspect project, mirrors, dependencies and support recipients.
2. Activate into a private operator-owned store, or export to a new directory. Keep existing verified copies until the replacement is checked.
3. Test `/`, `/.well-known/evolve-hosting.json`, and `/__evolve/`. Review HTTPS, MIME, CSP and CORS if exposing the mirror publicly. Publish your own reachable URL through the project's reviewed mirror process.
4. For a failed update, leave the prior pointer in place. For a valid but unwanted update, use explicit `rollback`, then test the app. Do not lower `sequence` or edit state to bypass the replay barrier.
5. If a process crashes during activation, inspect its lock and state before restarting. Never delete an active writer's lock. Protect key backups separately from release stores.
6. For a signing-key compromise, stop trusting new releases from that key, distribute a replacement through an independent channel, and provision a new reviewed store. V1 has no automatic revocation propagation.
7. For an uncertain donation outcome, keep the transaction ID and check the public chain/recipient. Do not automatically resend. Split transactions can complete independently. The fund owner must activate USDC reception before accepting development donations; the hosting project performs no funding transaction.

## Known first-release limits

No relay discovery, peer transport, offline service worker, automatic update fetching, operator reward calculation, card checkout, private backend replication or multi-region availability guarantee is implemented. Operators choose their own storage retention and public-service limits. The reviewed recipient list is a publisher trust decision, not permissionless automatic enrollment.
