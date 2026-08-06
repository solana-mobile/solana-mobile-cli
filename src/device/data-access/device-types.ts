import type { AdbDevice } from '../../localnet/data-access/localnet-types.ts'

export interface ConnectedDevice extends AdbDevice {
  /** AVD name for emulators, product model for physical devices. Only readable in the `device` state. */
  name?: string
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
