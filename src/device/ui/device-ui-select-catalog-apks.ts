import { multiselect } from '@clack/prompts'
import { type MultiSelectPrompt, resolvePromptCancellation } from '../../core/ui/core-ui-prompt-types.ts'
import type { ApkCatalogEntry } from '../data-access/apk-catalog.ts'

export async function selectCatalogApkNames(
  entries: readonly ApkCatalogEntry[],
  runMultiselect: MultiSelectPrompt = multiselect as MultiSelectPrompt,
): Promise<string[] | undefined> {
  const selected = await runMultiselect({
    message: 'Select APKs to install',
    options: entries.map((entry) => ({ hint: entry.description, label: entry.name, value: entry.name })),
    required: false,
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return selected
}
