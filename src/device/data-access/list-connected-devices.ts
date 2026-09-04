import { runExecutable } from '../../core/data-access/run-executable.ts'
import { parseRunningEmulatorName } from '../../emulator/data-access/list-running-emulators.ts'
import type { AdbDependencies, ConnectedDevice } from './device-types.ts'
import { isUsableDevice, listAdbDevices } from './list-adb-devices.ts'

/**
 * Every adb device with a human-readable name attached: the AVD name for emulators, the product model
 * for physical devices. Names are best-effort — an `offline` or `unauthorized` device rejects shell
 * commands, and a healthy one losing its name is no reason to drop it from the list.
 */
export async function listConnectedDevices({
  runCommand = runExecutable,
}: AdbDependencies = {}): Promise<ConnectedDevice[]> {
  const devices = await listAdbDevices({ runCommand })

  return Promise.all(
    devices.map(async (device) => {
      if (!isUsableDevice(device)) {
        return device
      }

      try {
        return { ...device, name: await readDeviceName(device.serial, { runCommand }) }
      } catch {
        return device
      }
    }),
  )
}

async function readDeviceName(
  serial: string,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<string | undefined> {
  if (serial.startsWith('emulator-')) {
    return parseRunningEmulatorName(await runCommand(['adb', '-s', serial, 'emu', 'avd', 'name']))
  }

  const model = (await runCommand(['adb', '-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim()

  return model || undefined
}

export function connectedDeviceLabel({ name, serial }: ConnectedDevice): string {
  return name ? `${name} (${serial})` : serial
}
