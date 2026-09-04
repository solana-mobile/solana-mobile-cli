import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies } from './device-types.ts'

/**
 * Best-effort visual proof: opens a URL in the device browser. Not a programmatic check — on a fresh
 * emulator the browser's first-run screen intercepts the intent.
 */
export async function openUrlOnDevice(
  serial: string,
  url: string,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  await runCommand(['adb', '-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])
}
