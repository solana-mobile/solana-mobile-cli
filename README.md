# solana-mobile

CLI for Solana Mobile development.

## Features

- **Command help** — show available subcommands when no command is provided
- **Create projects** — scaffold Solana Mobile apps from the template catalog
- **Doctor checks** — local dependency checks with recommendations
- **Emulator helpers** — create, delete, list, start, status, and stop local Android emulators
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

## License

Apache-2.0 – see [LICENSE](./LICENSE).
