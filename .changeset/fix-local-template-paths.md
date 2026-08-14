---
'solana-mobile': patch
---

Support local template paths in the create command and stop hanging on a failed clone.

A `--template` value starting with `/`, `./`, or `../` is now passed to create-solana-dapp as a
local template instead of being prefixed with `gh:`, which made cloning fail:

```shell
solana-mobile create my-app --template ../templates/mobile/expo-kit-anchor
```

A path that does not exist is reported before anything is created. When a create task does fail,
the command now exits with a non-zero status instead of leaving create-solana-dapp's spinner
running until the process is interrupted.
