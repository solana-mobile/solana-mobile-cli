import { select } from '@clack/prompts'
import { resolvePromptCancellation, type SelectPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import type { InstalledAvd } from '../data-access/emulator-types.ts'

export function createInstalledEmulatorOption({ device, name, target }: InstalledAvd) {
  const hint = [device ? `device: ${device}` : undefined, target ? `target: ${target}` : undefined]
    .filter(Boolean)
    .join(', ')

  return {
    hint: hint || undefined,
    label: name,
    value: name,
  }
}

export async function selectInstalledEmulatorName(
  avds: readonly InstalledAvd[],
  message: string,
  runSelect: SelectPrompt = select as SelectPrompt,
): Promise<string | undefined> {
  const selected = await runSelect({
    message,
    options: avds.map(createInstalledEmulatorOption),
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}
