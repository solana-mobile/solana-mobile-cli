---
'solana-mobile': patch
---

Fix `create --minimal`, which passed the transposed template name `kit-expo-minimal` instead of the catalog name `expo-kit-minimal`. The unknown name fell through to external resolution as `gh:kit-expo-minimal` and failed with `Error cloning the template`. The template name is now the exported `MINIMAL_TEMPLATE_NAME` constant, covered by tests. The README `--template` example was transposed the same way and is now `expo-kit-wallet`.
