import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies } from '../../localnet/data-access/localnet-types.ts'

export interface AdbInstallOptions {
  downgrade?: boolean
  grant?: boolean
}

export function buildAdbInstallCommand(
  serial: string,
  apkPath: string,
  options: AdbInstallOptions = {},
): [string, ...string[]] {
  return [
    'adb',
    '-s',
    serial,
    'install',
    '-r',
    ...(options.downgrade ? ['-d'] : []),
    ...(options.grant ? ['-g'] : []),
    apkPath,
  ]
}

export function extractAdbInstallFailure(output: string): string | undefined {
  return /Failure\s*\[([^\]]+)\]/.exec(output)?.[1]
}

/**
 * adb reports install failures two ways depending on version: a non-zero exit (rejected by the
 * runner) or a zero exit with `Failure [REASON]` in the output. Both surface here as an error
 * carrying the bare `INSTALL_FAILED_...` reason, without the surrounding adb noise.
 */
export async function installApk(
  serial: string,
  apkPath: string,
  options: AdbInstallOptions = {},
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  let output: string

  try {
    output = await runCommand(buildAdbInstallCommand(serial, apkPath, options), { combineOutput: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(extractAdbInstallFailure(message) ?? message)
  }

  const failure = extractAdbInstallFailure(output)

  if (failure) {
    throw new Error(failure)
  }
}
