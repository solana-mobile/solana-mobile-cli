import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies, AdbDevice } from './localnet-types.ts'

/**
 * Lists every adb device, unlike `listRunningEmulators`, which is deliberately limited to `emulator-*`
 * serials. Localnet forwards to physical devices too, so it needs the full list including non-usable
 * states so they can be reported rather than silently skipped.
 */
export async function listAdbDevices({ runCommand = runExecutable }: AdbDependencies = {}): Promise<AdbDevice[]> {
  return parseAdbDevices(await runCommand(['adb', 'devices']))
}

export function parseAdbDevices(contents: string): AdbDevice[] {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // Skip the header and the `* daemon started successfully *` chatter adb prints on cold start.
      if (line.startsWith('List of devices attached') || line.startsWith('*')) {
        return []
      }

      const [serial, state] = line.split(/\s+/)

      if (!serial || !state) {
        return []
      }

      return [{ serial, state }]
    })
    .sort((left, right) => left.serial.localeCompare(right.serial))
}

export function isUsableDevice({ state }: AdbDevice): boolean {
  return state === 'device'
}
