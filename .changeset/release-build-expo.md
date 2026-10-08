---
"solana-mobile": minor
---

Add `release build [directory]`, which builds a signed release APK of an Expo project for the Solana dApp Store. It runs the `release check` project checks, `expo prebuild` unless git tracks `android/`, and the project's Gradle wrapper, signs the APK with `--keystore-path` and `--keystore-alias` through `apksigner`, and checks the result like `release check --apk`. Passwords come from `SOLANA_MOBILE_KEYSTORE_PASSWORD` and `SOLANA_MOBILE_KEY_PASSWORD` or a prompt.
