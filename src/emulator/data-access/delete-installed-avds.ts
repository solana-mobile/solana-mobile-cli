import { runExecutable } from '../../core/data-access/run-executable.ts'
import { getToolPaths } from './avd-config.ts'
import type { DeleteInstalledAvdsDependencies } from './emulator-types.ts'
import { resolveAndroidSdkRoot } from './resolve-android-sdk-root.ts'

export async function deleteInstalledAvds(
  names: readonly string[],
  sdkRoot: string = resolveAndroidSdkRoot(),
  { runCommand = runExecutable }: DeleteInstalledAvdsDependencies = {},
): Promise<void> {
  const { avdmanager } = getToolPaths(sdkRoot)
  const results = await Promise.allSettled(
    names.map((name) => runCommand([avdmanager, 'delete', 'avd', '--name', name])),
  )
  const failures = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return []
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason)

    return [`${names[index]}: ${message}`]
  })

  if (failures.length > 0) {
    throw new Error(`Some emulators could not be deleted:\n- ${failures.join('\n- ')}`)
  }
}
