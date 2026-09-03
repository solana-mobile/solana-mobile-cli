---
'solana-mobile': patch
---

Bump the `fakewallet` catalog pin to `@solana-mobile/wallet-adapter-mobile@2.3.0`. The previously pinned `2.2.9` build had no localnet support — `chainOrClusterToRpcUri` only knew mainnet, devnet and testnet and threw `IllegalArgumentException` for anything else — so a wallet installed with `device install fakewallet` could not sign against a local validator. Localnet sign-and-send landed in [mobile-wallet-adapter#1610](https://github.com/solana-mobile/mobile-wallet-adapter/pull/1610) and first shipped in `2.3.0`.
