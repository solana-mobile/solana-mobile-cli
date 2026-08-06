import { select } from '@clack/prompts'
import { resolvePromptCancellation, type SelectPrompt } from '../../emulator/ui/emulator-ui-prompt-types.ts'
import type { ConnectedDevice } from '../data-access/device-types.ts'

export async function selectConnectedDeviceSerial(
  devices: readonly ConnectedDevice[],
  runSelect: SelectPrompt = select as SelectPrompt,
): Promise<string | undefined> {
  const selected = await runSelect({
    message: 'Select a device',
    options: devices.map(createConnectedDeviceOption),
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}

function createConnectedDeviceOption({ name, serial }: ConnectedDevice) {
  return {
    hint: name ? `serial: ${serial}` : undefined,
    label: name ?? serial,
    value: serial,
  }
}
