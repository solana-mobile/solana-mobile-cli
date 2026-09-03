import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies } from '../../localnet/data-access/localnet-types.ts'
import type { AppliedDeviceTweaks, ApplyDeviceTweaksOptions, DeviceTweak, SkippedDeviceTweak } from './device-types.ts'

export const DEVICE_TWEAKS: readonly DeviceTweak[] = [
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

/**
 * Applies the selected tweaks to one device, keeping going past failures: a tweak that a device or its
 * Android version does not support is reported as skipped instead of ending the run. Physical devices
 * reject more of them than emulators do — a device with a screen lock keeps its lock screen, for
 * instance. Defaults to the whole table, which is what the non-interactive callers want.
 */
export async function applyDeviceTweaks(
  serial: string,
  { tweaks = DEVICE_TWEAKS }: ApplyDeviceTweaksOptions = {},
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<AppliedDeviceTweaks> {
  const applied: DeviceTweak[] = []
  const skipped: SkippedDeviceTweak[] = []

  for (const tweak of tweaks) {
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
