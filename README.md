# solana-mobile

CLI for Solana Mobile development.

## Features

- **Command help** — show available subcommands when no command is provided
- **Create projects** — scaffold Solana Mobile apps from the template catalog
- **Device helpers** — list connected devices, install APKs, and open URLs, dev servers, and deep links on them
- **Doctor checks** — local dependency checks with recommendations
- **Emulator helpers** — create, delete, list, start, status, and stop local Android emulators
- **Local validator** — run surfpool or solana-test-validator in Docker and forward it to every connected device
- **Template repository checks** — verify that a template repository's generated artifacts are up to date

## Usage

Run the CLI without installing it:

```bash
bun x solana-mobile --help
npx solana-mobile --help
pnpx solana-mobile --help
```

Examples below use `npx`; replace it with `pnpx` or `bun x` if you prefer pnpm or Bun.

### Manage Android emulators

```bash
# Create or update an emulator, installing a system image when needed
npx solana-mobile emulator create

# Create or update a named emulator
npx solana-mobile emulator create local_phone --device pixel_9

# Delete by choosing from installed emulators
npx solana-mobile emulator delete

# Delete emulators by name
npx solana-mobile emulator delete local_phone

# Delete Android system images by choosing from installed images
npx solana-mobile emulator images delete

# Delete specific Android system images
npx solana-mobile emulator images delete system-images/android-35/google_apis_playstore/arm64-v8a

# Install an image for the latest installed Android platform
npx solana-mobile emulator images install

# Install by choosing from all available system images
npx solana-mobile emulator images install --all

# Install a specific Android system image
npx solana-mobile emulator images install system-images/android-36.1/google_apis_playstore/arm64-v8a

# List installed Android system images
npx solana-mobile emulator images list

# List installed emulators
npx solana-mobile emulator list

# Start by choosing from installed emulators
npx solana-mobile emulator start

# Start an emulator by name
npx solana-mobile emulator start local_phone

# Show status for all installed and running emulators
npx solana-mobile emulator status

# Show status for one emulator by name or serial
npx solana-mobile emulator status local_phone

# Stop by choosing from running emulators
npx solana-mobile emulator stop

# Stop a running emulator by name or serial
npx solana-mobile emulator stop local_phone

# Use the short alias
npx solana-mobile emu list
```

### Work with connected devices

Works with emulators and physical devices alike. When a URL points at `localhost`, its port is forwarded to the
device with `adb reverse` first, so a dev server on this computer opens on a USB device too.

```bash
# List connected devices and emulators, with names and states
npx solana-mobile device list

# List as JSON
npx solana-mobile device list --json

# Open by choosing from the URLs the device can already reach; devices with several
# connected pick from a list, a single device is used directly
npx solana-mobile device open

# Open a URL in the device browser
npx solana-mobile device open http://localhost:18488/

# Open a dev server by port
npx solana-mobile device open 3000

# Open a deep link (quoted so the shell does not glob the ?)
npx solana-mobile device open 'myapp://claim?id=123'

# Target a specific device
npx solana-mobile device open 3000 --device SM02E4072816572

# Open without creating an adb reverse for localhost URLs
npx solana-mobile device open 3000 --no-forward

# Explain URL and port forwarding decisions
npx solana-mobile device open 3000 --verbose
```

### Install APKs

Installs local APK files, every `.apk` in a directory, or known ecosystem APKs by name from the built-in
catalog (currently `fakewallet`, the Mobile Wallet Adapter test wallet). Catalog downloads are cached, so
repeat installs skip the network. Installs continue past failures and report a summary at the end.

```bash
# Pick catalog APKs from a list
npx solana-mobile device install

# Install a catalog APK by name
npx solana-mobile device install fakewallet

# Install local APK files and every .apk in a directory
npx solana-mobile device install app.apk ./builds/

# Install on every connected device
npx solana-mobile device install fakewallet --all

# Allow version downgrades and grant all runtime permissions
npx solana-mobile device install app.apk --downgrade --grant

# Re-download a catalog APK even when cached
npx solana-mobile device install fakewallet --force

# List the APKs available in the catalog
npx solana-mobile device install --list
```

### Run a local validator

Give apps running in an emulator or on a physical device access to a validator on your machine, so you can develop
against localnet instead of devnet.

```bash
# Start a validator, forward it to every connected device, and keep the forwards alive
npx solana-mobile localnet

# Leave it running in the background
npx solana-mobile localnet start --detach

# Use solana-test-validator instead of surfpool
npx solana-mobile localnet start --engine test-validator

# Forward an already-running validator without starting one
npx solana-mobile localnet forward

# Verify the validator is reachable from every device
npx solana-mobile localnet check
npx solana-mobile localnet check --json

# Show the validator and port forward status
npx solana-mobile localnet status

# Print validator logs
npx solana-mobile localnet logs

# Stop the validator and remove its port forwards
npx solana-mobile localnet stop
```

The default engine is [surfpool](https://github.com/txtx/surfpool); `--engine test-validator` runs
`solana-test-validator` instead.

`localnet` checks the RPC port before it starts anything. If a validator already answers there — a native build you
are running yourself, or one you started by hand — it attaches to that instead of starting a container, and reports
which one it found:

```
│  Found a validator already running on http://localhost:8899 (surfnet 0.12.0). Not starting a container.
```

This is what makes working on a validator itself practical: run your build, then forward it.

```bash
cargo run -- start --no-tui     # your own surfpool build on 8899
npx solana-mobile localnet      # attaches to it, forwards it, no container
```

Docker is only needed when localnet actually has to start a container. It never stops a validator it did not start,
and `Ctrl-C` removes only the port forwards in that case.

Forwarding uses `adb reverse`, so the same URL works everywhere — on an emulator, on a USB device, and on your
machine. `localnet` prints the endpoints it set up:

```
RPC     http://localhost:8899
WS      ws://localhost:8900
Studio  http://localhost:18488
```

Point your app's RPC configuration at the RPC URL, whatever your project calls it. With surfpool, open the Studio URL
in your browser to inspect accounts, transactions, and logs.

Reverse forwards are removed whenever an emulator reboots, a device is unplugged, or `adb kill-server` runs. Watching
is on by default for `localnet` and `localnet start`, which re-applies them when a device connects, reconnects, or
reboots; pass `--no-watch` to disable it. Only forwards this session created are ever removed, so unrelated forwards
such as Metro on `8081` — and a reverse you had already set up on a localnet port — are left alone.

`--detach` is one-shot: it applies the forwards and exits, so nothing is left running to re-apply them. Re-run
`localnet forward` after a device reconnects or reboots, or keep `localnet` in the foreground to have it watched.
A detached run records which forwards it created in `~/.solana-mobile/localnet-forwards.json` so that a later
`localnet stop` removes exactly those and leaves everything else alone; `stop` deletes the file when it is done.

The validator is published on `127.0.0.1` only, so it is reachable from this machine and through `adb reverse`, but
not from the rest of the network.

`--port` moves the **host** port only. The device keeps seeing the canonical port, so app configuration never changes:

```bash
# Validator published on host port 9899; the device still uses http://localhost:8899
npx solana-mobile localnet start --port 9899
```

`--engine` and the host port options are read back from the running container, so a detached session does not need
them repeated:

```bash
npx solana-mobile localnet start --detach --engine test-validator --port 9899
npx solana-mobile localnet status   # reports test-validator on 9899
```

`localnet check` verifies two things separately, because neither alone covers the path: a real JSON-RPC call from
your machine proves the validator is alive, and on the device side `adb reverse --list` is compared against the exact
host port expected before a TCP connect from inside the device proves the tunnel carries traffic. Checking the
mapping matters because `adbd` accepts on the device listener even when the reverse points at a dead host port.
Android ships no HTTP client, so the device leg cannot make an RPC call itself.

If `check` passes but your app still cannot connect, the usual cause is cleartext HTTP: Android blocks `http://` by
default from API 28. Allow it for local development with `android:usesCleartextTraffic="true"` or a network security
config in `AndroidManifest.xml`.

### Create a project

```bash
# Create a project interactively
npx solana-mobile create

# Create a project with the minimal template
npx solana-mobile create my-app --minimal

# Create a project with a package manager
npx solana-mobile create my-app --package-manager pnpm

# Create a project with a specific template
npx solana-mobile create my-app --template expo-kit-wallet

# Create a project from a template on disk
npx solana-mobile create my-app --template ../templates/mobile/expo-kit-wallet

# List template ids as JSON
npx solana-mobile create --list-template-ids

# List templates
npx solana-mobile create --list-templates
```

### Check your environment

```bash
npx solana-mobile doctor
npx solana-mobile doctor --json
npx solana-mobile doctor --verbose
```

Doctor checks the system, JavaScript tooling, Java/JDK, Android SDK components, emulators, and physical Android
devices. It reports separate readiness for project creation, Android builds, emulator workflows, and physical-device
workflows.

The command is diagnostic only and never installs or modifies dependencies. Missing required dependencies produce
exit code `1`; warnings do not.

### Check a template repository

```bash
# Check the template repository in the current directory
npx solana-mobile templates check

# Check a template repository somewhere else
npx solana-mobile templates check --root ../solana-mobile-templates
```

The command reads the repository and reports every problem it finds — invalid template manifests, missing or
incorrectly sized `og-image.png` files, duplicate template names, and generated artifacts (`.github/workflows/templates.json`,
`TEMPLATES.md`, and `templates.json`) that are missing or out of date. Artifacts are only compared once the templates
themselves are valid. Nothing is written; problems produce exit code `1`, which makes it usable as a CI check.

### Generate template repository artifacts

```bash
# Generate artifacts for the template repository in the current directory
npx solana-mobile templates generate

# Generate artifacts for a template repository somewhere else
npx solana-mobile templates generate --root ../solana-mobile-templates
```

The command renders the same artifacts `templates check` compares against and writes the ones that are missing or out
of date, leaving already up-to-date files untouched. An invalid repository produces exit code `1` and nothing is
written, so `generate` never turns template problems into stale artifacts.

### Sync a template repository

```bash
# Preview a sync from the current directory into another template repository
npx solana-mobile templates sync ../solana-foundation-templates --dry-run

# Sync the templates
npx solana-mobile templates sync ../solana-foundation-templates

# Sync from a template repository somewhere else
npx solana-mobile templates sync ../solana-foundation-templates --root ../solana-mobile-templates
```

The command mirrors every group declared in the source repository's `repokit.groups` into the target repository.
Groups are matched by `path`; the target must declare a matching group, and groups that only exist in the target are
left untouched. Within a synced group the source is authoritative: templates are added, updated, and removed so the
target matches the source exactly. Only files tracked by git in the source are ever copied, so gitignored files like
dependencies and build output never cross over — symlinks are recreated as symlinks and executable bits are
preserved. Files that are gitignored in the target (local env files, installed dependencies) are never deleted: they
survive template updates, and a removed template whose directory still contains ignored files is kept with a warning
instead of being deleted. The source repository must pass `templates check` before anything is written, the target
must have no uncommitted changes under the synced groups (override with `--force`), and generated artifacts have to
be regenerated in the target afterwards because template ids embed the repository name.

### Show command help

```bash
npx solana-mobile
```

### Create options

- `--dry-run` — Print the resolved creation arguments without writing files
- `--list-template-ids` — List available template ids as a JSON array
- `--list-templates` — List available templates
- `--list-versions` — Verify local Anchor, AVM, Rust, and Solana versions
- `--minimal` — Use the minimal Solana Mobile template
- `--package-manager <packageManager>` — Use `bun`, `npm`, `pnpm`, or `yarn`
- `--skip-git` — Skip git initialization
- `--skip-init` — Skip the template init script
- `--skip-install` — Skip dependency installation
- `--template <templateName>` — Use a specific template
- `--verbose` — Print verbose output

### Templates check options

- `--root <path>` — Template repository root, defaults to the current directory

## Development

Install dependencies and run checks:

```bash
bun install
bun run ruler:apply  # apply AI agent rules
bun run check-types
bun run lint
bun test
```

### Test the local CLI

Run the source CLI while developing:

```bash
bun dev create --help
bun dev doctor
bun dev emulator list
```

Build and test the package artifact:

```bash
bun run build
node dist/cli.mjs create --help
node dist/cli.mjs doctor
```

## Testing

Unit tests (`bun test`) run without any external dependencies.

Integration tests boot each `localnet` engine for real and check it answers JSON-RPC, which the unit tests cannot
do — they only assert the `docker run` command we build, not that it works. Those require Docker:

```bash
bun run test:integration
```

They use their own container name and host ports, so running them will not disturb a `solana-mobile localnet`
session. CI runs them nightly and on pull requests that touch `src/localnet/`, because the images and their flags
can change with no commit on our side.

## License

Apache-2.0 – see [LICENSE](./LICENSE).
