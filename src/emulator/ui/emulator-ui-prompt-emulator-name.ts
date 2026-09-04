import { text } from '@clack/prompts'
import { resolvePromptCancellation, type TextPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import { DEFAULT_PROFILE } from '../data-access/avd-config.ts'

export async function promptEmulatorName(
  defaultName: string = DEFAULT_PROFILE.name,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const selected = await runText({
    defaultValue: defaultName,
    initialValue: defaultName,
    message: 'Emulator name',
    validate: (value) => (value.trim().length > 0 ? undefined : 'Emulator name is required.'),
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected.trim()
}
