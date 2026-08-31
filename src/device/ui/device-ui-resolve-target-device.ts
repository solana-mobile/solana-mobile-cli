import type { PromptDependencies } from '../../emulator/ui/emulator-ui-prompt-types.ts'
import type { ConnectedDevice } from '../data-access/device-types.ts'
import { selectConnectedDeviceSerial } from './device-ui-select-connected-device.ts'

/**
 * `undefined` covers three cases the caller can tell apart: no devices at all (report and fail), an
 * unknown `--device` serial (thrown instead, so it never returns), and a cancelled picker (exit quietly —
 * the prompt already printed the cancellation).
 */
export async function resolveTargetDevice(
  devices: readonly ConnectedDevice[],
  requestedSerial: string | undefined,
  { runSelect }: PromptDependencies,
): Promise<ConnectedDevice | undefined> {
  if (requestedSerial) {
    const requested = devices.find(({ serial }) => serial === requestedSerial)

    if (!requested) {
      throw new Error(`Device not connected or not ready: ${requestedSerial}`)
    }

    return requested
  }

  if (devices.length === 0) {
    return undefined
  }

  if (devices.length === 1) {
    return devices[0]
  }

  const serial = await selectConnectedDeviceSerial(devices, runSelect)

  return devices.find((device) => device.serial === serial)
}
