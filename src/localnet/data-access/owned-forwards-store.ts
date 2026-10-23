import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import type { OwnedForward } from './localnet-types.ts'

export interface OwnedForwardsStoreDependencies {
  getTempDirectory?: () => string
  readTextFile?: (path: string) => Promise<string>
  removeFile?: (path: string) => Promise<void>
  writeTextFile?: (path: string, contents: string) => Promise<void>
}

/**
 * Where a detached session records the reverses it created.
 *
 * A container label cannot do this job: `--detach` may attach to a validator someone else is running, in
 * which case there is no container to label — yet that path still tells the user to clean up with
 * `localnet stop`. Keeping the record outside Docker covers both paths with one mechanism, and it also
 * survives a session that is killed outright rather than interrupted.
 *
 * It lives in the temp directory because a reboot drops every reverse it describes. The user name keeps
 * users apart on a shared `/tmp`.
 */
export function ownedForwardsPath(getTempDirectory: () => string = tmpdir): string {
  return join(getTempDirectory(), `solana-mobile-localnet-forwards-${userInfo().username}.json`)
}

/**
 * `undefined` means no record exists, which callers must read as "ownership unknown" rather than
 * "owned nothing" — the two lead to opposite teardown decisions.
 */
export async function readOwnedForwards({
  getTempDirectory = tmpdir,
  readTextFile = (path) => readFile(path, 'utf8'),
}: OwnedForwardsStoreDependencies = {}): Promise<OwnedForward[] | undefined> {
  let contents: string

  try {
    contents = await readTextFile(ownedForwardsPath(getTempDirectory))
  } catch {
    return undefined
  }

  return parseOwnedForwards(contents)
}

export function parseOwnedForwards(contents: string): OwnedForward[] | undefined {
  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch {
    return undefined
  }

  if (!Array.isArray(parsed)) {
    return undefined
  }

  return parsed.flatMap((entry) => {
    const { devicePort, serial } = (entry ?? {}) as { devicePort?: unknown; serial?: unknown }

    return typeof serial === 'string' && Number.isInteger(devicePort)
      ? [{ devicePort: devicePort as number, serial }]
      : []
  })
}

/**
 * Unions claims, keeping one entry per device and port.
 *
 * A repeated `start --detach` finds every reverse already correct, so it applies nothing and claims
 * nothing. Writing that empty set over the previous record would assert the session owns nothing at all —
 * a definite claim, not an unknown one — and `stop` would then leave the first run's reverses behind.
 *
 * Merging in a stale claim is harmless by comparison: `planRemovals` only ever removes reverses that
 * still exist, so an entry for something already gone is a no-op.
 */
export function mergeOwnedForwards(...sources: readonly (readonly OwnedForward[])[]): OwnedForward[] {
  const merged = new Map<string, OwnedForward>()

  for (const forward of sources.flat()) {
    merged.set(`${forward.serial}:${forward.devicePort}`, forward)
  }

  return [...merged.values()].sort(
    (left, right) => left.serial.localeCompare(right.serial) || left.devicePort - right.devicePort,
  )
}

export async function writeOwnedForwards(
  forwards: readonly OwnedForward[],
  {
    getTempDirectory = tmpdir,
    writeTextFile = (path, contents) => writeFile(path, contents, 'utf8'),
  }: OwnedForwardsStoreDependencies = {},
): Promise<void> {
  await writeTextFile(ownedForwardsPath(getTempDirectory), `${JSON.stringify(forwards)}\n`)
}

export async function clearOwnedForwards({
  getTempDirectory = tmpdir,
  removeFile = (path) => rm(path, { force: true }),
}: OwnedForwardsStoreDependencies = {}): Promise<void> {
  await removeFile(ownedForwardsPath(getTempDirectory))
}
