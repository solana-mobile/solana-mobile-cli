---
"solana-mobile": minor
---

`emulator create` and `emulator images install` now default to an API level 36 system image instead of the newest one Google ships, and the prompt lists every Google Play image for the host with the default first. The newest image is not always one that boots: the current `android-37.0` image kernel-panics on some Windows hosts. The `--all` flag is gone since the prompt already shows everything, and an installed SDK platform is no longer required to install an image.
