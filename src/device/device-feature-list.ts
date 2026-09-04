import { runExecutable } from '../core/data-access/run-executable.ts'
import type { AdbDependencies, DeviceListCommandOptions } from './data-access/device-types.ts'
import { listConnectedDevices } from './data-access/list-connected-devices.ts'
import { renderConnectedDevices } from './ui/device-ui-render-connected-devices.ts'

export async function runDeviceList(
  options: DeviceListCommandOptions = {},
  { runCommand = runExecutable }: AdbDependencies = {},
) {
  const devices = await listConnectedDevices({ runCommand })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`)
    return
  }

  renderConnectedDevices(devices)
}
