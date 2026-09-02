---
'solana-mobile': minor
---

Add a `playground` command that serves a bundled wallet-testing web page, forwards it to a connected device with `adb reverse`, opens it in the device browser, and streams each Mobile Wallet Adapter interaction back to the terminal until interrupted. The page exercises connect, sign-in (SIWS), sign message, sign transaction, and sign-and-send against a chosen cluster (`--cluster devnet|testnet|mainnet|localnet`, default devnet, with `--url` to override the RPC endpoint), replacing the scaffold-an-app-and-throw-it-away loop for quick wallet testing.
