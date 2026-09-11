---
"solana-mobile": patch
---

`doctor` no longer reports `emulator`, `avdmanager` or `sdkmanager` as available when the file exists but cannot be run. It now warns with the error, which is what `emulator create` would hit.
