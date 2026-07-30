---
'solana-mobile': patch
---

Show an animated spinner while fetching available system images and installing a system image in non-verbose mode, instead of leaving the terminal static for the duration of the underlying `sdkmanager`/`android` command. `--verbose` still shows the full raw command output as before.
