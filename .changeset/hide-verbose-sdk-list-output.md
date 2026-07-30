---
'solana-mobile': patch
---

Only echo the raw `sdkmanager`/`android sdk list` output to the terminal in `--verbose` mode. Previously `emulator create` and `emulator images install` always dumped the full installed/available system-image package listing into the task log, even without `--verbose`.
