import type { AdbDevice } from '../../localnet/data-access/localnet-types.ts'

export interface ApplyDeviceTweaksOptions {
  /** Defaults to every tweak in `DEVICE_TWEAKS`. */
  tweaks?: readonly DeviceTweak[]
}

export interface AppliedDeviceTweaks {
  applied: readonly DeviceTweak[]
  skipped: readonly SkippedDeviceTweak[]
}

export interface ConnectedDevice extends AdbDevice {
  /** AVD name for emulators, product model for physical devices. Only readable in the `device` state. */
  name?: string
}

export interface DeviceInstallCommandOptions {
  all?: boolean
  apks?: string[]
  device?: string
  downgrade?: boolean
  force?: boolean
  grant?: boolean
  list?: boolean
  verbose?: boolean
}

export interface DeviceListCommandOptions {
  json?: boolean
}

export interface DeviceOpenCommandOptions {
  device?: string
  /** Commander's `--no-forward` parses to `false`; anything else means forwarding is allowed. */
  forward?: boolean
  url?: string
  verbose?: boolean
}

export interface DeviceTuneCommandOptions {
  all?: boolean
  device?: string
  /** Skip the tweak picker and apply every tweak, for unattended runs. */
  yes?: boolean
}

export interface DeviceTweak {
  // Each entry is the argument list for one `adb -s <serial> shell <...command>` invocation.
  commands: readonly (readonly string[])[]
  description: string
  name: string
}

export interface SkippedDeviceTweak {
  reason: string
  tweak: DeviceTweak
}
