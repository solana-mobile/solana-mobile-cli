---
'solana-mobile': minor
---

Add a `device install` command that installs APKs from files, directories, or a built-in catalog.

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
