import { multiselect } from '@clack/prompts'
import { systemImagePackageToRelativeDirectory } from '../data-access/avd-config.ts'
import { type MultiSelectPrompt, resolvePromptCancellation } from './emulator-ui-prompt-types.ts'

export async function selectInstalledSystemImages(
  systemImages: readonly string[],
  runMultiselect: MultiSelectPrompt = multiselect as MultiSelectPrompt,
): Promise<string[] | undefined> {
  const selected = await runMultiselect({
    message: 'Select system images to delete',
    options: systemImages.map((systemImage) => ({
      label: systemImagePackageToRelativeDirectory(systemImage),
      value: systemImage,
    })),
    required: false,
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}
