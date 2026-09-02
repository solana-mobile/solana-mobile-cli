import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Walks up from this module to the package root, in both the src (dev) and dist (published) layouts. */
export function findWebshellTemplateDir(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let current = startDir
  while (true) {
    if (existsSync(join(current, 'package.json'))) {
      return join(current, 'templates', 'webshell-android')
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new Error('Could not locate the webshell template directory')
    }
    current = parent
  }
}
