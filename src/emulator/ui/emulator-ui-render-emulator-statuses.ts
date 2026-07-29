import type { EmulatorStatus } from '../data-access/emulator-types.ts'
import { NO_INSTALLED_EMULATORS_MESSAGE } from './emulator-ui-messages.ts'

export function renderEmulatorStatuses(statuses: readonly EmulatorStatus[]) {
  if (statuses.length === 0) {
    console.log(NO_INSTALLED_EMULATORS_MESSAGE)
    return
  }

  console.table(
    statuses.map(({ booted, device, name, serial, state, target }) => ({
      booted,
      device: device ?? '',
      name,
      serial: serial ?? '',
      state,
      target: target ?? '',
    })),
    ['booted', 'device', 'name', 'serial', 'state', 'target'],
  )
}
