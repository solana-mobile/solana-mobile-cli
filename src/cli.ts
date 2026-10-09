#!/usr/bin/env node

import { runApp } from './app.ts'

let settled = false

// A @clack prompt only resolves on submit or cancel, so when stdin closes (CI, `< /dev/null`) the event
// loop drains with the command still pending and the process would exit 0 as if it had succeeded.
process.on('beforeExit', () => {
  if (settled) {
    return
  }
  process.stdout.write('\u001B[?25h')
  console.error('Input ended while a prompt was waiting. Run interactively or pass the missing values as flags.')
  process.exitCode = 1
})

runApp()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    settled = true
  })
