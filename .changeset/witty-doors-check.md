---
'solana-mobile': patch
---

Remove the SDK licenses check from the doctor command. Android SDK Command-line Tools v23 deprecated `sdkmanager` and turned `sdkmanager --licenses` into a no-op that prints "The --licenses option is no longer needed", so license acceptance is no longer a separate step the doctor can or needs to verify.
