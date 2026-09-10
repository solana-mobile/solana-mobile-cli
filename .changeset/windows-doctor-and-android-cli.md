---
"solana-mobile": patch
---

Make `doctor` and `emulator images install` work on Windows. `doctor` now finds npm and the other `.cmd`/`.bat` tools. `emulator create` and `emulator images install` read the available system images from Google's repository feed and confirm an install by the image landing on disk, so the Android CLI crashing on exit no longer fails them.
