---
"solana-mobile": patch
---

Fix the `emulator` commands on Windows. `emulator create`, `emulator delete` and `emulator images` looked for `avdmanager` and `sdkmanager` under their POSIX names, so on Windows they reported the Command-line Tools as missing even when installed; they now resolve the `.bat` launchers and run them through `cmd.exe`, and `emulator start` launches `emulator.exe`. The Android SDK root also defaults to `%LOCALAPPDATA%\Android\Sdk` on Windows and `~/Android/Sdk` on Linux instead of the macOS path everywhere, and `ANDROID_HOME` now takes precedence over the deprecated `ANDROID_SDK_ROOT`, matching Android Studio and the `doctor` command. The `doctor` command no longer reports a tool as available on Windows when only its extensionless shell script is present.
