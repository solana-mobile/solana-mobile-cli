import type { InstalledAvd } from '../data-access/emulator-types.ts'
import { NO_INSTALLED_EMULATORS_MESSAGE } from './emulator-ui-messages.ts'

export function renderInstalledEmulators(avds: readonly InstalledAvd[]) {
  if (avds.length === 0) {
    console.log(NO_INSTALLED_EMULATORS_MESSAGE)
    return
  }

  console.table(
    avds.map(({ device, name, target }) => ({
      device: device ?? '',
      name,
      target: target ?? '',
    })),
    ['device', 'name', 'target'],
  )
}
