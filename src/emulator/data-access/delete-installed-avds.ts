import { homedir } from 'node:os'
import { resolveAndroidSdkRoot } from '../../core/data-access/android-sdk-root.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import { defaultPathExists, getAvdDirectoryPath, getAvdRegistrationPath } from './create-avd.ts'
import type { DeleteInstalledAvdsDependencies, DeleteInstalledAvdsResult, PathChecker } from './emulator-types.ts'
import { resolveAndroidCommandLineTool } from './resolve-android-command-line-tool.ts'

/**
 * Deletes AVDs through `avdmanager`, skipping names that have nothing on disk so removing a leftover emulator is
 * idempotent. Per-name failures are reported rather than thrown, leaving the wording to the caller.
 */
export async function deleteInstalledAvds(
  names: readonly string[],
  sdkRoot: string = resolveAndroidSdkRoot(),
  {
    getHomeDirectory = homedir,
    pathExists = defaultPathExists(),
    platform,
    readDirectory,
    runCommand = runExecutable,
  }: DeleteInstalledAvdsDependencies = {},
): Promise<DeleteInstalledAvdsResult> {
  const homeDirectory = getHomeDirectory()
  const checked = await Promise.all(
    names.map(async (name) => ({ installed: await isAvdOnDisk(homeDirectory, name, pathExists), name })),
  )
  const installed = checked.filter(({ installed }) => installed)
  const notInstalled = checked.filter(({ installed }) => !installed).map(({ name }) => name)

  // Resolved only once something needs deleting: a missing avdmanager must not fail a no-op delete.
  if (installed.length === 0) {
    return { deleted: [], failures: [], notInstalled }
  }

  const avdmanager = await resolveAndroidCommandLineTool(sdkRoot, 'avdmanager', { pathExists, platform, readDirectory })
  const outcomes = await Promise.all(
    installed.map(async ({ name }): Promise<DeleteOutcome> => {
      try {
        await runCommand([avdmanager, 'delete', 'avd', '--name', name])
        return { name }
      } catch (error) {
        return { failure: `${name}: ${error instanceof Error ? error.message : error}`, name }
      }
    }),
  )

  return {
    deleted: outcomes.filter(({ failure }) => !failure).map(({ name }) => name),
    failures: outcomes.flatMap(({ failure }) => (failure ? [failure] : [])),
    notInstalled,
  }
}

interface DeleteOutcome {
  failure?: string
  name: string
}

/**
 * Both artifacts are checked because either one alone is still `avdmanager delete avd`'s job to clean up, so a
 * half-written AVD must not be reported as absent.
 */
async function isAvdOnDisk(homeDirectory: string, name: string, pathExists: PathChecker): Promise<boolean> {
  const [hasDirectory, hasRegistration] = await Promise.all([
    pathExists(getAvdDirectoryPath(homeDirectory, name)),
    pathExists(getAvdRegistrationPath(homeDirectory, name)),
  ])

  return hasDirectory || hasRegistration
}
