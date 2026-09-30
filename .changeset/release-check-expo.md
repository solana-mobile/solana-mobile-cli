---
"solana-mobile": minor
---

Add `release check [directory]`, which checks that an Expo project is ready for a Solana dApp Store release: app name, Android package, version name, versionCode, icons, and, whenever `android/` exists, that its release build is not signed with the debug key and that Gradle's values match the app config. It defaults to the current directory, takes `--json` and `--verbose`, and never modifies the project.
