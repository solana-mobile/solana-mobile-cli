---
'solana-mobile': minor
---

Add `solana-mobile device`, helpers for connected devices and emulators.

- `device open [url]` opens a URL in the device browser through a VIEW intent, replacing the
  `adb -s <serial> shell am start -a android.intent.action.VIEW -d <url>` incantation. It accepts a full URL, a bare
  port (`device open 3000` opens `http://localhost:3000`), a bare host, or a deep link like `myapp://claim`.
- When the URL points at `localhost` with an explicit port, the port is forwarded to the device with `adb reverse`
  first, so a dev server on this computer opens on a USB device too. An existing reverse on that port is kept, not
  clobbered — it may be localnet's, whose `--port` deliberately moves the host side. `--no-forward` opts out, and
  `--verbose` explains each URL and port forwarding decision.
- With no URL, the device's existing reverses are offered as suggestions — they are exactly the localhost ports the
  device can reach — with free-text entry as the fallback, and known ports (Metro, Solana RPC/WS, Surfpool Studio)
  get a descriptive hint.
- A single connected device is used directly; several prompt for a choice, and `--device <serial>` skips the prompt.
- `device list` shows every adb device with its state and a human-readable name — the AVD name for emulators, the
  product model for physical devices. `--json` prints a stable report.
