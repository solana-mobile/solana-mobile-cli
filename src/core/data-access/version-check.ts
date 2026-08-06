import type { PackageMetadata } from './package-metadata.ts'

const FETCH_TIMEOUT_MS = 1500

export type FetchLatestVersion = (packageName: string) => Promise<string | undefined>

export type VersionCheckOptions = {
  env?: NodeJS.ProcessEnv
  fetchLatestVersion?: FetchLatestVersion
  isTty?: boolean
  metadata: PackageMetadata
}

export type VersionCheckResult = {
  current: string
  latest: string
}

/**
 * Resolves with update info when a newer version is published on npm, undefined otherwise.
 *
 * Never throws and never waits longer than the fetch timeout: an unreachable registry means no
 * update notice, not a broken CLI. Skips entirely in CI, without a terminal, under tests, and for
 * preview builds (`0.0.0-*`), where an update notice is noise nobody can act on.
 */
export async function checkForNewerVersion({
  env = process.env,
  fetchLatestVersion = fetchLatestVersionFromNpm,
  isTty = process.stderr.isTTY === true,
  metadata,
}: VersionCheckOptions): Promise<VersionCheckResult | undefined> {
  if (skipVersionCheck(env, isTty) || metadata.version.startsWith('0.0.0-')) {
    return undefined
  }

  const latest = await fetchLatestVersion(metadata.name)

  if (!latest || !isVersionGreater(latest, metadata.version)) {
    return undefined
  }

  return { current: metadata.version, latest }
}

export function isVersionGreater(left: string, right: string): boolean {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)

  if (!leftVersion || !rightVersion) {
    return false
  }

  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major > rightVersion.major
  }

  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor > rightVersion.minor
  }

  return leftVersion.patch > rightVersion.patch
}

async function fetchLatestVersionFromNpm(packageName: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      return undefined
    }

    const data = (await response.json()) as { version?: unknown }

    return typeof data.version === 'string' ? data.version : undefined
  } catch {
    return undefined
  }
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value !== 'false'
}

function parseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)

  if (!match) {
    return undefined
  }

  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function skipVersionCheck(env: NodeJS.ProcessEnv, isTty: boolean): boolean {
  return isTruthy(env.CI) || isTruthy(env.SOLANA_MOBILE_SKIP_VERSION_CHECK) || env.NODE_ENV === 'test' || !isTty
}
