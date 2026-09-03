---
'solana-mobile': minor
---

Make emulator tuning opt-in. **Breaking:** the `--no-tune` flag is removed from `emulator create` and `emulator start`; `emulator start` and `emulator create --start` no longer apply the agent-friendly tweaks automatically. Pass `--tune` to apply them after boot, or run `emulator tune` against a running emulator. Passing `--tune` to `emulator create` without `--start` is now rejected instead of silently ignored.
