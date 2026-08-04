import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { EmulatorAdbDevice, ListRunningEmulatorsDependencies, RunningEmulator } from './emulator-types.ts'

export async function listRunningEmulators({
  runCommand = runExecutable,
}: ListRunningEmulatorsDependencies = {}): Promise<RunningEmulator[]> {
  const serials = parseAdbEmulatorDevices(await runCommand(['adb', 'devices']))
    .filter(({ state }) => state === 'device')
    .map(({ serial }) => serial)
  const runningEmulators = await Promise.all(
    serials.map(async (serial) => ({
      name: parseRunningEmulatorName(await runCommand(['adb', '-s', serial, 'emu', 'avd', 'name'])) ?? serial,
      serial,
    })),
  )

  return runningEmulators.sort(
    (left, right) => left.name.localeCompare(right.name) || left.serial.localeCompare(right.serial),
  )
}

export function parseAdbEmulatorDevices(contents: string): EmulatorAdbDevice[] {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.startsWith('List of devices attached')) {
        return []
      }

      const [serial, state] = line.split(/\s+/, 3)

      if (!serial?.startsWith('emulator-') || !state) {
        return []
      }

      return [
        {
          serial,
          state,
        },
      ]
    })
    .sort((left, right) => left.serial.localeCompare(right.serial))
}

export function parseRunningEmulatorName(contents: string): string | undefined {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && value !== 'OK')
}
