import type { ConnectedDevice } from '../data-access/device-types.ts'
import { NO_CONNECTED_DEVICES_MESSAGE } from './device-ui-messages.ts'

export function renderConnectedDevices(devices: readonly ConnectedDevice[]) {
  if (devices.length === 0) {
    console.log(NO_CONNECTED_DEVICES_MESSAGE)
    return
  }

  console.table(
    devices.map(({ name, serial, state }) => ({
      name: name ?? '',
      serial,
      state,
    })),
    ['name', 'serial', 'state'],
  )
}
