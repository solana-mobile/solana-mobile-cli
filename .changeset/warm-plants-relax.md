---
'solana-mobile': patch
---

Fix broken output framing in the emulator commands: every early return now closes its intro/outro box instead of leaving it dangling, and status messages are printed through clack's boxed logger instead of raw `console.log` so they render with the connecting bar instead of breaking out of the box.
