import { select } from '@clack/prompts'
import { resolvePromptCancellation, type SelectPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import { parseSystemImagePackage, systemImagePackageToRelativeDirectory } from '../data-access/avd-config.ts'

export async function selectSystemImage(
  systemImages: readonly string[],
  runSelect: SelectPrompt = select as SelectPrompt,
): Promise<string | undefined> {
  const selected = await runSelect({
    initialValue: systemImages[0],
    message: 'Select a system image to install',
    options: systemImages.map((systemImage) => {
      const suffix =
        parseSystemImagePackage(systemImage).tagId === 'google_apis_playstore_ps16k' ? ' (16 KB page size)' : ''

      return {
        label: `${systemImagePackageToRelativeDirectory(systemImage)}${suffix}`,
        value: systemImage,
      }
    }),
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}
