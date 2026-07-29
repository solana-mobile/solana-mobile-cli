# solana-mobile

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
