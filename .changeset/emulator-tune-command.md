---
'solana-mobile': minor
---

Add an `emulator tune` command that applies agent-friendly tweaks to a running emulator, and run
it automatically after `emulator start` and `emulator create --start` (skip with `--no-tune`).

```shell
solana-mobile emulator tune
solana-mobile emulator tune my_emulator
solana-mobile emulator start my_emulator --no-tune
```

The tweaks silence the first-contact noise that trips up automation agents on a fresh AVD: the
stylus handwriting onboarding overlay, Chrome's sign-in first-run and notification permission
dialogs, the new-tab feed and tips cards, boot-time system and Play Store notifications, window
animations, touch sounds and haptics, autofill prompts, and the lock screen, while keeping the
screen awake and marking device setup as complete.

Tweaks only ever target emulators: candidates are resolved from `emulator-*` adb serials and the
target must report an emulator property (`ro.boot.qemu`/`ro.kernel.qemu`) before any tuning command runs,
so a physical device serial is refused.
