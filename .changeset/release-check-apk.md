---
"solana-mobile": minor
---

`release check` takes `--apk <path>` to check the built APK too: its package, version name and versionCode must match the app config, it must not be debuggable, and its signature must verify with a certificate other than the Android debug one. It uses `aapt2` and `apksigner` from the Android SDK Build-Tools.
