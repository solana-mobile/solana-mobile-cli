---
'solana-mobile': minor
---

Add `solana-mobile localnet`, which runs a local Solana validator and forwards it to every connected emulator and
physical device with `adb reverse`, so apps talk to `http://localhost:8899` on an emulator, on a USB device, and on
the host with the same configuration.

- `localnet` / `localnet start` bring the validator up, wait for it to accept RPC, forward its ports, and keep the
  forwards alive as devices come and go. `--detach` leaves it running; `--no-watch` disables reconciliation.
- The RPC port is probed before Docker is touched. If a validator already answers there — a natively-run build, for
  instance — localnet attaches to it instead of starting a container, so that path needs no Docker at all.
- `localnet forward` wires up an already-running validator, `localnet check` verifies it, and `localnet status`,
  `localnet logs`, and `localnet stop` cover the rest of the lifecycle.
- Engines are `surfpool` (default) and `test-validator`, matching the container contracts in
  `@beeman/testcontainers`. `--image` overrides the image.
- `--port` moves only the host port; the device keeps seeing the canonical port, so app configuration never changes.
- Container ports are published on `127.0.0.1` only, so the validator is reachable from this machine and through
  `adb reverse` but is not exposed to the rest of the network.
- `--detach` is one-shot: it applies the forwards and exits, leaving nothing behind to re-apply them.
- `status`, `check`, and `stop` read the engine and the published host ports back from the running container, so a
  detached session does not need its flags repeated. Asking for an engine other than the one running is reported
  rather than silently ignored.
- Options are accepted before or after the subcommand, so `localnet --port 9899 status` and
  `localnet status --port 9899` behave the same.
- Teardown removes only what the session created. An attached validator, a container left by an earlier `--detach`,
  and a reverse that already existed on a localnet port are all left alone, and `adb reverse --remove-all` is never
  used, so unrelated forwards such as Metro on `8081` survive. A container that merely shares the name but was not
  created by localnet is reported instead of being force-removed.

`localnet check` reports the host and device legs separately. A JSON-RPC call from the host proves the validator is
alive. On the device, `adb reverse --list` is compared against the exact expected host port before a TCP connect
proves the tunnel carries traffic — the mapping check is what catches a misrouted reverse, because `adbd` accepts on
the device listener even when the reverse points at a dead or wrong host port. Android ships no HTTP client, so the
device leg cannot make an RPC call itself.
