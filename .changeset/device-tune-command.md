---
'solana-mobile': minor
---

Add `device tune`, the `device` namespace twin of `emulator tune`, so the agent-friendly tweaks no longer depend on `emulator start --tune` or `emulator create --start --tune`. It targets devices the way the other `device` commands do: no target picks the only connected device or prompts when several are connected, `--device <serial>` targets one, and `--all` tunes every connected device. Unlike `emulator tune` it also accepts physical devices, and a tweak the device rejects is reported as skipped instead of failing the run.

Both `device tune` and `emulator tune` now ask which tweaks to apply, with every tweak pre-selected so Enter applies the lot; `-y, --yes` skips the picker and applies all of them for unattended runs. The `--tune` flags on `emulator create` and `emulator start` stay non-interactive and apply every tweak.
