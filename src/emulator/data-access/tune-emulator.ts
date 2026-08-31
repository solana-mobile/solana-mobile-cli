import { runExecutable } from '../../core/data-access/run-executable.ts'
import type {
  AppliedEmulatorTweaks,
  CommandRunner,
  EmulatorTweak,
  RunningEmulator,
  SkippedEmulatorTweak,
  TuneEmulatorDependencies,
  TuneEmulatorResult,
  WaitForEmulatorBootDependencies,
} from './emulator-types.ts'
import { listRunningEmulators } from './list-running-emulators.ts'

// Emulator system images report at least one of these as 1; physical devices report neither.
const EMULATOR_PROPERTIES = ['ro.boot.qemu', 'ro.kernel.qemu'] as const

export const EMULATOR_TWEAKS: readonly EmulatorTweak[] = [
  {
    commands: [
      ['settings', 'put', 'global', 'animator_duration_scale', '0'],
      ['settings', 'put', 'global', 'transition_animation_scale', '0'],
      ['settings', 'put', 'global', 'window_animation_scale', '0'],
    ],
    description: 'Disable window, transition, and animator animations',
    name: 'animations-off',
  },
  {
    commands: [['settings', 'put', 'secure', 'autofill_service', 'null']],
    description: 'Disable the autofill service and its prompts',
    name: 'autofill-off',
  },
  {
    commands: [
      // Granting the permission stops Chrome from ever prompting; the appop blocks actual delivery.
      ['pm', 'grant', 'com.android.chrome', 'android.permission.POST_NOTIFICATIONS'],
      ['appops', 'set', 'com.android.chrome', 'POST_NOTIFICATION', 'ignore'],
    ],
    description: 'Silence Chrome notifications and its permission prompt',
    name: 'chrome-notifications-off',
  },
  {
    // Marking Chrome as the debug app makes it read the flags in /data/local/tmp/chrome-command-line.
    commands: [
      [
        'echo',
        'chrome --disable-fre --no-default-browser-check --no-first-run --disable-features=AndroidTipsNotifications,EducationalTipModule,InterestFeedV2,MagicStackAndroid --enable-features=FeedHeaderRemoval,HomeButtonRemoval:apply_to_all_countries/true/remove_home_button_everywhere/true',
        '>',
        '/data/local/tmp/chrome-command-line',
      ],
      ['am', 'set-debug-app', '--persistent', 'com.android.chrome'],
    ],
    description: 'Skip Chrome first-run sign-in and disable the new-tab feed and shortcuts',
    name: 'chrome-quiet',
  },
  {
    commands: [
      ['settings', 'put', 'system', 'haptic_feedback_enabled', '0'],
      ['settings', 'put', 'system', 'sound_effects_enabled', '0'],
    ],
    description: 'Disable touch sounds and haptic feedback',
    name: 'keyboard-feedback-off',
  },
  {
    commands: [['locksettings', 'set-disabled', 'true']],
    description: 'Disable the lock screen',
    name: 'lockscreen-off',
  },
  {
    commands: [
      ['settings', 'put', 'global', 'device_provisioned', '1'],
      ['settings', 'put', 'secure', 'user_setup_complete', '1'],
    ],
    description: 'Mark device setup and provisioning as complete',
    name: 'provisioning-complete',
  },
  {
    commands: [
      ['settings', 'put', 'global', 'stay_on_while_plugged_in', '7'],
      ['settings', 'put', 'system', 'screen_off_timeout', '1800000'],
    ],
    description: 'Keep the screen on while charging and extend the screen timeout',
    name: 'screen-awake',
  },
  {
    commands: [
      ['settings', 'put', 'secure', 'stylus_handwriting_education_shown', '1'],
      ['settings', 'put', 'secure', 'stylus_handwriting_enabled', '0'],
    ],
    description: 'Disable stylus handwriting and its onboarding popup',
    name: 'stylus-handwriting',
  },
  {
    commands: [
      ['appops', 'set', 'android', 'POST_NOTIFICATION', 'ignore'],
      ['appops', 'set', 'com.android.vending', 'POST_NOTIFICATION', 'ignore'],
      ['appops', 'set', 'com.google.android.gms', 'POST_NOTIFICATION', 'ignore'],
    ],
    description: 'Silence system, Play Store, and Play services notifications',
    name: 'system-notifications-off',
  },
]

export async function applyEmulatorTweaks(
  serial: string,
  { runCommand = runExecutable }: TuneEmulatorDependencies = {},
): Promise<AppliedEmulatorTweaks> {
  await assertEmulatorSerial(serial, runCommand)

  const applied: EmulatorTweak[] = []
  const skipped: SkippedEmulatorTweak[] = []

  for (const tweak of EMULATOR_TWEAKS) {
    try {
      for (const command of tweak.commands) {
        await runCommand(['adb', '-s', serial, 'shell', ...command])
      }
      applied.push(tweak)
    } catch (error) {
      skipped.push({ reason: `${error}`, tweak })
    }
  }

  return { applied, skipped }
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

  return { emulator, ...(await applyEmulatorTweaks(emulator.serial, { runCommand })) }
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
