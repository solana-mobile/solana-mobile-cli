import { homedir } from 'node:os'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import { getToolPaths } from './avd-config.ts'
import { defaultPathExists, getAvdDirectoryPath, getAvdRegistrationPath } from './create-avd.ts'
import type { DeleteInstalledAvdsDependencies, DeleteInstalledAvdsResult, PathChecker } from './emulator-types.ts'
import { resolveAndroidSdkRoot } from './resolve-android-sdk-root.ts'

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
    runCommand = runExecutable,
  }: DeleteInstalledAvdsDependencies = {},
): Promise<DeleteInstalledAvdsResult> {
  const { avdmanager } = getToolPaths(sdkRoot)
  const homeDirectory = getHomeDirectory()
  const checked = await Promise.all(
    names.map(async (name) => ({ installed: await isAvdOnDisk(homeDirectory, name, pathExists), name })),
  )
  const outcomes = await Promise.all(
    checked
      .filter(({ installed }) => installed)
      .map(async ({ name }): Promise<DeleteOutcome> => {
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
    notInstalled: checked.filter(({ installed }) => !installed).map(({ name }) => name),
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
