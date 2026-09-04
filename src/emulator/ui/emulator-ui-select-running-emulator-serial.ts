import { select } from '@clack/prompts'
import { resolvePromptCancellation, type SelectPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import type { RunningEmulator } from '../data-access/emulator-types.ts'

export async function selectRunningEmulatorSerial(
  runningEmulators: readonly RunningEmulator[],
  message: string,
  runSelect: SelectPrompt = select as SelectPrompt,
): Promise<string | undefined> {
  const selected = await runSelect({
    message,
    options: runningEmulators.map(createRunningEmulatorOption),
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}

function createRunningEmulatorOption({ name, serial }: RunningEmulator) {
  return {
    hint: `serial: ${serial}`,
    label: name,
    value: serial,
  }
}
