---
'solana-mobile': patch
---

Fix `emulator create` and `emulator delete` hanging forever when their work failed. Both wrapped the work in clack's `tasks()`, which stops its spinner only once the task resolves; a rejecting task left the spinner running, and a live spinner keeps a timer and a raw-mode stdin listener attached, so the process never exited even though the error was printed and the exit code was set. Both now report the failure after the task group completes. `emulator delete` is also idempotent: deleting an emulator that is not installed reports `Emulator not installed: <name>` and exits 0 instead of failing, so "remove any leftover, then create" no longer needs to probe the AVD directory first.
