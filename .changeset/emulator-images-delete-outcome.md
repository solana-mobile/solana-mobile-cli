---
"solana-mobile": patch
---

Make `emulator images delete` work on Windows. The removal is confirmed by the images being gone from disk instead of the tool's exit code, so the Android CLI crashing on exit after a successful `sdk remove` no longer reports a failure. A clean exit that leaves an image behind now fails with the tool's output.
