---
"solana-mobile": patch
---

`webshell init`: a root-absolute icon `src` in a local web manifest (such as `/icon-512.png`) now resolves against the manifest's directory instead of the filesystem root, and a manifest whose icons are all unsupported formats warns instead of silently keeping the default launcher icon
