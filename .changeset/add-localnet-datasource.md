---
'solana-mobile': minor
---

Let `localnet` fork from a remote datasource instead of always starting an empty, offline chain.

- `--network devnet|mainnet|testnet` forks the validator from a public cluster, and `--rpc-url` from any RPC
  endpoint. With surfpool, every account the app touches — programs included, at their original addresses — is
  fetched from that cluster on first access, and the validator reports the cluster's genesis hash.
- `solana-test-validator` does not fetch lazily, so there the datasource is cloned up front: `--clone` names an
  account and `--clone-upgradeable-program` an upgradeable program to copy in (both repeatable). Clone flags without
  a datasource, or with surfpool — which needs none — are reported rather than silently ignored, as is naming a
  datasource with both `--network` and `--rpc-url`.
- The datasource is recorded on the container, so `localnet status` reports it and a later `localnet start` refuses
  to reuse a running validator as a datasource it was not started with. When localnet attaches to a validator it did
  not start, it says that datasource options do not apply instead of pretending they did.
