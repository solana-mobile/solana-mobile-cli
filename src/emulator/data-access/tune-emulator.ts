import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AppliedDeviceTweaks, ApplyDeviceTweaksOptions } from '../../device/data-access/device-types.ts'
import { applyDeviceTweaks } from '../../device/data-access/tune-device.ts'
import type {
  CommandRunner,
  RunningEmulator,
  TuneEmulatorDependencies,
  TuneEmulatorResult,
  WaitForEmulatorBootDependencies,
} from './emulator-types.ts'
import { listRunningEmulators } from './list-running-emulators.ts'

// Emulator system images report at least one of these as 1; physical devices report neither.
const EMULATOR_PROPERTIES = ['ro.boot.qemu', 'ro.kernel.qemu'] as const

/**
 * Tweaks a target that must be an emulator. `device tune` applies the same tweaks to anything adb is
 * attached to; this entry point refuses a physical device, so an emulator name that resolved to the
 * wrong serial cannot silently reconfigure a real phone.
 */
export async function applyEmulatorTweaks(
  serial: string,
  { tweaks }: ApplyDeviceTweaksOptions = {},
  { runCommand = runExecutable }: TuneEmulatorDependencies = {},
): Promise<AppliedDeviceTweaks> {
  await assertEmulatorSerial(serial, runCommand)

  return applyDeviceTweaks(serial, { tweaks }, { runCommand })
}

async function assertEmulatorSerial(serial: string, runCommand: CommandRunner): Promise<void> {
  for (const property of EMULATOR_PROPERTIES) {
    try {
      if ((await runCommand(['adb', '-s', serial, 'shell', 'getprop', property])).trim() === '1') {
        return
      }
    } catch {
      // A property read can fail while adb settles; the other property or the final error covers it.
    }
  }

  throw new Error(`Refusing to tune ${serial}: it does not report an Android emulator property.`)
}

export function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function tuneEmulator(
  nameOrSerial: string,
  { tweaks }: ApplyDeviceTweaksOptions = {},
  { runCommand = runExecutable }: TuneEmulatorDependencies = {},
): Promise<TuneEmulatorResult> {
  const runningEmulators = await listRunningEmulators({ runCommand })
  const matchingEmulators = runningEmulators.filter(
    (emulator) => emulator.name === nameOrSerial || emulator.serial === nameOrSerial,
  )

  if (matchingEmulators.length === 0) {
    throw new Error(`Emulator is not running: ${nameOrSerial}`)
  }

  if (matchingEmulators.length > 1) {
    throw new Error(`Multiple running emulators match ${nameOrSerial}. Tune by serial instead.`)
  }

  const emulator = matchingEmulators[0] as RunningEmulator

  return { emulator, ...(await applyEmulatorTweaks(emulator.serial, { tweaks }, { runCommand })) }
}

export async function waitForEmulatorBoot(
  nameOrSerial: string,
  {
    pollIntervalMs = 2_000,
    runCommand = runExecutable,
    sleep = defaultSleep,
    timeoutMs = 180_000,
  }: WaitForEmulatorBootDependencies = {},
): Promise<RunningEmulator> {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`pollIntervalMs must be a positive number: ${pollIntervalMs}`)
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`timeoutMs must be a non-negative number: ${timeoutMs}`)
  }

  let elapsedMs = 0

  while (true) {
    let matchingEmulators: RunningEmulator[] = []

    try {
      matchingEmulators = (await listRunningEmulators({ runCommand })).filter(
        (candidate) => candidate.name === nameOrSerial || candidate.serial === nameOrSerial,
      )
    } catch {
      // adb is transiently unavailable while the emulator boots; keep polling until the timeout.
    }

    if (matchingEmulators.length > 1) {
      throw new Error(`Multiple running emulators match ${nameOrSerial}. Tune by serial instead.`)
    }

    const emulator = matchingEmulators[0]

    if (emulator) {
      try {
        if (
          (await runCommand(['adb', '-s', emulator.serial, 'shell', 'getprop', 'sys.boot_completed'])).trim() === '1'
        ) {
          return emulator
        }
      } catch {
        // getprop can fail while the emulator boots; keep polling until the timeout.
      }
    }

    if (elapsedMs >= timeoutMs) {
      break
    }

    // The cap makes the final sleep land exactly on the timeout boundary.
    const sleepMs = Math.min(pollIntervalMs, timeoutMs - elapsedMs)
    await sleep(sleepMs)
    elapsedMs += sleepMs
  }

  throw new Error(`Emulator did not boot within ${Math.round(timeoutMs / 1000)} seconds: ${nameOrSerial}`)
}
