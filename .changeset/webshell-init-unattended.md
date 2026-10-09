---
"solana-mobile": patch
---

`webshell init`: without a terminal every prompt that has a default takes it (application id derived from the URL, version `1`/`1.0`, `android.keystore`, alias `android`) and a prompt without one fails with a message naming the flag, so CI only needs `--url` and `--app-name` or a manifest; the keystore prompt now defaults to a bare `android.keystore` relative to the project directory
