---
"solana-mobile": patch
---

Fail `emulator images install` and `emulator create` when the installer exits cleanly without putting the system image on disk, and show the installer's output in the error. `sdkmanager` warns and exits 0 for a package it cannot find, which previously reported the install as done.
