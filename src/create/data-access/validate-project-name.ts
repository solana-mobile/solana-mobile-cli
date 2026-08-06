import { existsSync } from 'node:fs'
import { z } from 'zod'

// Vendored from https://github.com/solana-foundation/create-solana-dapp/pull/274.
// TODO: replace with the `projectNameSchema` and `validateProjectName` exports from
// create-solana-dapp once that PR ships in the `latest` tag.

// The project name becomes the name of the generated package and the search key the init
// script uses to rename the template, so it must be a valid npm package name: lowercase
// letters, digits, and single dashes, starting with a letter. npm caps names at 214 characters.
export const projectNameSchema = z
  .string()
  .min(1, 'Please enter at least 1 character')
  .max(214, 'Please enter a name with at most 214 characters')
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    'Please enter a valid project name (lowercase letters, numbers, and single dashes, starting with a letter)',
  )

export function validateProjectName(name: string): string | undefined {
  const result = projectNameSchema.safeParse(name)
  if (!result.success) {
    // Upstream reads `issues[0].message` directly; this repo compiles with noUncheckedIndexedAccess.
    return result.error.issues[0]?.message ?? 'Please enter a valid project name'
  }
  // Check if the directory already exists
  if (existsSync(name)) {
    return 'Directory already exists'
  }
  return undefined
}
