import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { APK_CATALOG, type ApkCatalogEntry, findApkCatalogEntry } from './apk-catalog.ts'

export type ApkInstallItem = { entry: ApkCatalogEntry; kind: 'catalog' } | { kind: 'local'; path: string }

export interface ResolveApkArgsDependencies {
  listDirectory?: (path: string) => Promise<string[]>
  pathKind?: (path: string) => Promise<PathKind>
}

export type PathKind = 'directory' | 'file' | undefined

export async function defaultListDirectory(path: string): Promise<string[]> {
  return readdir(path)
}

export async function defaultPathKind(path: string): Promise<PathKind> {
  try {
    return (await stat(path)).isDirectory() ? 'directory' : 'file'
  } catch {
    return undefined
  }
}

/**
 * Each argument is a file, a directory (expanded to every `.apk` inside), or a catalog name —
 * existence on disk decides which, so a stray typo falls through to the catalog and fails with the
 * valid names instead of reaching adb.
 */
export async function resolveApkArgs(
  args: readonly string[],
  { listDirectory = defaultListDirectory, pathKind = defaultPathKind }: ResolveApkArgsDependencies = {},
): Promise<ApkInstallItem[]> {
  const items: ApkInstallItem[] = []

  for (const arg of args) {
    const kind = await pathKind(arg)

    if (kind === 'file') {
      items.push({ kind: 'local', path: arg })
      continue
    }

    if (kind === 'directory') {
      const apks = (await listDirectory(arg)).filter((name) => name.toLowerCase().endsWith('.apk')).sort()

      if (apks.length === 0) {
        throw new Error(`No .apk files found in directory: ${arg}`)
      }

      items.push(...apks.map((name) => ({ kind: 'local' as const, path: join(arg, name) })))
      continue
    }

    const entry = findApkCatalogEntry(arg)

    if (!entry) {
      throw new Error(
        `Not a file, directory, or catalog APK: ${arg}\nCatalog APKs: ${APK_CATALOG.map(({ name }) => name).join(', ')}`,
      )
    }

    items.push({ entry, kind: 'catalog' })
  }

  return items
}
