import { multiselect } from '@clack/prompts'
import type { InstalledAvd } from '../data-access/emulator-types.ts'
import { type MultiSelectPrompt, resolvePromptCancellation } from './emulator-ui-prompt-types.ts'
import { createInstalledEmulatorOption } from './emulator-ui-select-installed-emulator-name.ts'

export async function selectInstalledEmulatorNames(
  avds: readonly InstalledAvd[],
  runMultiselect: MultiSelectPrompt = multiselect as MultiSelectPrompt,
): Promise<string[] | undefined> {
  const selected = await runMultiselect({
    message: 'Select emulators to delete',
    options: avds.map(createInstalledEmulatorOption),
    required: false,
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}
