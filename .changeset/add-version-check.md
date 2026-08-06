---
'solana-mobile': minor
---

Warn when a newer version of the CLI is published on npm, so globally installed or dependency-pinned installations
hear about updates without invoking `npx solana-mobile@latest`.

- The check runs before every command, compares the running version against the npm registry's `latest` tag, and
  prints a warning to stderr with the update instruction that matches how the CLI was invoked: a package runner
  (`npx`, `bunx`, `pnpm dlx`, `yarn dlx`), a project dependency run through a package script, or a global install.
- It never blocks: the command always runs, an unreachable registry is silently ignored, and the lookup is capped
  at 1.5 seconds.
- It is skipped automatically in CI, without a terminal, under tests, and for preview builds (`0.0.0-*`), and can
  be disabled explicitly with `--skip-version-check` (accepted before or after the subcommand) or
  `SOLANA_MOBILE_SKIP_VERSION_CHECK=1`.
