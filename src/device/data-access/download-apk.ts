import { createHash } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { type ApkCatalogEntry, githubReleaseDownloadUrl } from './apk-catalog.ts'

export interface DownloadApkDependencies {
  downloadFile?: (url: string, destination: string, expectedSha256?: string) => Promise<void>
  fileExists?: (path: string) => Promise<boolean>
  getCacheDirectory?: () => string
}

export function defaultApkCacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'solana-mobile', 'apks')
}

export async function defaultDownloadFile(url: string, destination: string, expectedSha256?: string): Promise<void> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }

  const content = Buffer.from(await response.arrayBuffer())

  // Verified before anything touches the disk, so a tampered or corrupted download never becomes a
  // cache entry that adb install would trust.
  if (expectedSha256) {
    const digest = createHash('sha256').update(content).digest('hex')

    if (digest !== expectedSha256) {
      throw new Error(`Download failed SHA-256 verification (expected ${expectedSha256}, got ${digest}): ${url}`)
    }
  }

  await mkdir(dirname(destination), { recursive: true })

  // Written next to the destination and renamed so an interrupted download never leaves a truncated
  // APK where the cache check would treat it as complete.
  const partial = `${destination}.partial`

  await writeFile(partial, content)
  await rename(partial, destination)
}

export async function defaultFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Resolves a catalog entry to a local APK path, downloading into the cache only when the pinned
 * tag's asset is not already there. The tag is part of the cache path, so bumping a pin never
 * serves a stale APK.
 */
export async function ensureApkDownloaded(
  entry: ApkCatalogEntry,
  { force = false }: { force?: boolean } = {},
  {
    downloadFile = defaultDownloadFile,
    fileExists = defaultFileExists,
    getCacheDirectory = defaultApkCacheDirectory,
  }: DownloadApkDependencies = {},
): Promise<{ downloaded: boolean; path: string }> {
  const path = join(getCacheDirectory(), entry.name, encodeURIComponent(entry.source.tag), entry.source.asset)

  if (!force && (await fileExists(path))) {
    return { downloaded: false, path }
  }

  await downloadFile(githubReleaseDownloadUrl(entry.source), path, entry.source.sha256)

  return { downloaded: true, path }
}
