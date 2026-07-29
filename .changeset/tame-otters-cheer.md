---
'solana-mobile': patch
---

Preserve the package-runner prefix in emulator create's suggested delete/start commands, and route emulator create/delete/start/stop output through an injectable log dependency instead of calling console.log directly.
