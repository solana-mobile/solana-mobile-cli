---
'solana-mobile': minor
---

Pass template-defined command options through the create command.

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
