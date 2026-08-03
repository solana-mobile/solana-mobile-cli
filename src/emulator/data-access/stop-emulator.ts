import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { RunningEmulator, StopEmulatorDependencies } from './emulator-types.ts'
import { listRunningEmulators } from './list-running-emulators.ts'

export async function stopEmulator(
  nameOrSerial: string,
  { runCommand = runExecutable }: StopEmulatorDependencies = {},
): Promise<RunningEmulator> {
  const runningEmulators = await listRunningEmulators({ runCommand })
  const matchingEmulators = runningEmulators.filter(
    (emulator) => emulator.name === nameOrSerial || emulator.serial === nameOrSerial,
  )

  if (matchingEmulators.length === 0) {
    throw new Error(`Emulator is not running: ${nameOrSerial}`)
  }

  if (matchingEmulators.length > 1) {
    throw new Error(`Multiple running emulators match ${nameOrSerial}. Stop by serial instead.`)
  }

  const emulator = matchingEmulators[0] as RunningEmulator

  await runCommand(['adb', '-s', emulator.serial, 'emu', 'kill'])

  return emulator
}
