---
'solana-mobile': patch
---

Add a matching intro/outro to `emulator create`, `emulator delete`, `emulator start`, `emulator stop`, `emulator images`, and `emulator images install` so every interactive command is framed consistently, and report failures in those commands through a graceful `cancel()` message instead of an unhandled error.
