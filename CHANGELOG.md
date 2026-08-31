# solana-mobile

## 0.3.0

### Minor Changes

- 4db15a4: Add a `device install` command that installs APKs from files, directories, or a built-in catalog.

  ```shell
  # Pick catalog APKs from a list
  solana-mobile device install

  # Install a catalog APK by name
  solana-mobile device install fakewallet

  # Install local APK files and every .apk in a directory
  solana-mobile device install app.apk ./builds/
  ```

  The catalog ships with `fakewallet` (the Mobile Wallet Adapter test wallet, pinned to
  `@solana-mobile/wallet-adapter-mobile@2.2.9`), downloaded from GitHub releases and cached under
  `~/.cache/solana-mobile/apks/` so repeat installs skip the network (`--force` re-downloads).
  `--all` installs on every connected device, `--downgrade` and `--grant` map to `adb install -d`
  and `-g`, and `--list` prints the catalog. Installs continue past failures and report a summary,
  exiting non-zero when anything failed.

- 52d435e: Add an `emulator tune` command that applies agent-friendly tweaks to a running emulator, and run
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

### Patch Changes

- 9f83795: Support local template paths in the create command and stop hanging on a failed clone.

  A `--template` value starting with `/`, `./`, or `../` is now passed to create-solana-dapp as a
  local template instead of being prefixed with `gh:`, which made cloning fail:

  ```shell
  solana-mobile create my-app --template ../templates/mobile/expo-kit-anchor
  ```

  A path that does not exist is reported before anything is created. When a create task does fail,
  the command now exits with a non-zero status instead of leaving create-solana-dapp's spinner
  running until the process is interrupted.

## 0.2.0

### Minor Changes

- 2168823: Add `solana-mobile device`, helpers for connected devices and emulators.

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

- da9abf9: Add `solana-mobile localnet`, which runs a local Solana validator and forwards it to every connected emulator and
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

- 4d756ca: Pass template-defined command options through the create command.

  Templates can now declare boolean options that run a package.json script after cloning, and the
  create command passes any unknown boolean long flag through to create-solana-dapp, e.g.:

  ```shell
  solana-mobile create my-app --minimal --reset-project
  ```

  Requires the template to declare the option in its `create-solana-dapp` init script config;
  unsupported flags fail before dependencies are installed.

  The interactive flow now selects the template before asking for the project name and pre-fills
  the name from the selected template, matching create-solana-dapp. Project names — prompted or
  positional — now require lowercase kebab-case npm package names (vendored from
  solana-foundation/create-solana-dapp#274 until it ships in `latest`). Combining `--minimal` with
  `--template` is now an error, and an auto-detected package manager no longer fails on templates
  that require a specific one.

- 5786f61: Add a read-only command and public `solana-mobile/templates` helpers for checking generated template repository artifacts.
- ed3e811: Add a `templates generate` command and public `writeTemplateRepository` helper for writing generated template repository artifacts.
- 2500c3e: Add a `templates sync` command that mirrors the git-tracked templates of a repository's `repokit.groups` into another template repository.
- bc5e83a: Warn when a newer version of the CLI is published on npm, so globally installed or dependency-pinned installations
  hear about updates without invoking `npx solana-mobile@latest`.

  - The check runs before every command, compares the running version against the npm registry's `latest` tag, and
    prints a warning to stderr with the update instruction that matches how the CLI was invoked: a package runner
    (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`), a project dependency run through a package script, or a global install.
  - It never blocks: the command always runs, an unreachable registry is silently ignored, and the lookup is capped
    at 1.5 seconds.
  - It is skipped automatically in CI, without a terminal, under tests, and for preview builds (`0.0.0-*`), and can
    be disabled explicitly with `--skip-version-check` (accepted before or after the subcommand) or
    `SOLANA_MOBILE_SKIP_VERSION_CHECK=1`.

### Patch Changes

- 8e7fa42: Fix `create --minimal`, which passed the transposed template name `kit-expo-minimal` instead of the catalog name `expo-kit-minimal`. The unknown name fell through to external resolution as `gh:kit-expo-minimal` and failed with `Error cloning the template`. The template name is now the exported `MINIMAL_TEMPLATE_NAME` constant, covered by tests. The README `--template` example was transposed the same way and is now `expo-kit-wallet`.

## 0.1.3

### Patch Changes

- 34d9ae7: Show an animated spinner while fetching available system images and installing a system image in non-verbose mode, instead of leaving the terminal static for the duration of the underlying `sdkmanager`/`android` command. `--verbose` still shows the full raw command output as before.
- cad79e1: Only echo the raw `sdkmanager`/`android sdk list` output to the terminal in `--verbose` mode. Previously `emulator create` and `emulator images install` always dumped the full installed/available system-image package listing into the task log, even without `--verbose`.

## 0.1.2

### Patch Changes

- da1263e: Render emulator command output through the right clack primitive instead of plain log lines: `note` for actionable next-step hints, `tasks` for per-item work in `emulator create`/`emulator delete`, and `taskLog` for the subprocess calls in `emulator images install`/`emulator images delete`, including the previously unindicated system-image catalog fetch.

  Drop the redundant plain log line that duplicated the `note` box title when no emulators are installed or running, and use a plain "Done" outro consistently instead of restating the note above it.

## 0.1.1

### Patch Changes

- 787c354: Add a matching intro/outro to `emulator create`, `emulator delete`, `emulator start`, `emulator stop`, `emulator images`, and `emulator images install` so every interactive command is framed consistently, and report failures in those commands through a graceful `cancel()` message instead of an unhandled error.
- b4a3ad4: Detect bunx, pnpm dlx, and yarn dlx (in addition to npx) when formatting suggested CLI commands.
- a46b101: Add emulator image management commands; delete, discover, install, and list Android system images; optionally show all available install choices; prefer the Android CLI with sdkmanager as a fallback; scope the default choices to the latest installed Android platform; sort choices by Android version; select the newest image by default; and show a loading spinner while installing an image unless verbose output is enabled.
- 29141cf: Fix `package.json` `bugs`, `homepage`, and `repository` URLs to point to `solana-mobile/solana-mobile-cli` instead of a stale `beeman/solana-mobile` reference, and correct the `license` field to `Apache-2.0` to match the `LICENSE` file.
- 1df07b4: Prevent deleting running Android emulators and preserve npx in the suggested stop command.
- 80e0139: Switch project license from MIT to Apache License 2.0.
- 0b4b590: Preserve the package-runner prefix in emulator create's suggested delete/start commands, and route emulator create/delete/start/stop output through an injectable log dependency instead of calling console.log directly.
- a47bd2e: Fix broken output framing in the emulator commands: every early return now closes its intro/outro box instead of leaving it dangling, and status messages are printed through clack's boxed logger instead of raw `console.log` so they render with the connecting bar instead of breaking out of the box.

## 0.1.0

### Minor Changes

- d0c338f: Expand `doctor` with comprehensive Java, Android SDK, emulator, device, and readiness diagnostics plus verbose and JSON output.

## 0.0.1

### Patch Changes

- ad6e5b8: Add the doctor command and switch the package to a CLI-only surface.
- 677cabf: Add a create command for bootstrapping Solana Mobile projects from the Solana Mobile template catalog.
- 802a066: Use the create-solana-dapp public create flow API instead of a patched internal bundle.
- 2bfe846: Add emulator lifecycle commands for creating, listing, starting, checking, and stopping Android emulators.
- 1a02d78: Inline CLI package metadata so npx installs do not read wrapper package files.
- 56cf640: Run the published CLI with Node instead of Bun.
- f2ee903: Use the canonical git repository URL in package metadata.
- 5ea62c3: Show command help instead of an interactive menu when no command is provided.
- c05ed30: Add npm package metadata required for trusted publishing provenance.
