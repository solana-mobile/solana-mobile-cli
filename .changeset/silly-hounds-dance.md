---
'solana-mobile': patch
---

Render emulator command output through the right clack primitive instead of plain log lines: `note` for actionable next-step hints, `tasks` for per-item work in `emulator create`/`emulator delete`, and `taskLog` for the subprocess calls in `emulator images install`/`emulator images delete`, including the previously unindicated system-image catalog fetch.

Drop the redundant plain log line that duplicated the `note` box title when no emulators are installed or running, and use a plain "Done" outro consistently instead of restating the note above it.
