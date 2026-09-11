---
"solana-mobile": patch
---

`doctor` reported `sdkmanager` and `avdmanager` as not runnable on machines where they work: both exit non-zero on `-version`. Only a tool that fails to start is reported that way now.
