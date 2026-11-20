---
'solana-mobile': minor
---

`create` accepts a path as its positional argument, so `create ./apps/my-app` and `create /tmp/my-app` create the project there. The last path segment becomes the project name and is the part that has to be a valid package name; the existence check runs on the resolved directory.
