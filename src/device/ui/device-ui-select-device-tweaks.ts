import { multiselect } from '@clack/prompts'
import { type MultiSelectPrompt, resolvePromptCancellation } from '../../emulator/ui/emulator-ui-prompt-types.ts'
import type { DeviceTweak } from '../data-access/device-types.ts'
import { DEVICE_TWEAKS } from '../data-access/tune-device.ts'

/**
 * The tweaks a tune should apply: every one of them when `--yes` skipped the picker, otherwise whatever
 * is left selected in it. `undefined` means the picker was cancelled.
 */
export async function resolveDeviceTweaks(
  { yes }: { yes?: boolean },
  runMultiselect?: MultiSelectPrompt,
): Promise<readonly DeviceTweak[] | undefined> {
  return yes ? DEVICE_TWEAKS : selectDeviceTweaks(DEVICE_TWEAKS, runMultiselect)
}

/**
 * Every tweak starts selected: applying the lot is the common case, so Enter is the fast path and
 * deselecting is the exception. `undefined` means the picker was cancelled.
 */
export async function selectDeviceTweaks(
  tweaks: readonly DeviceTweak[],
  runMultiselect: MultiSelectPrompt = multiselect as MultiSelectPrompt,
): Promise<DeviceTweak[] | undefined> {
  const selected = await runMultiselect({
    initialValues: tweaks.map(({ name }) => name),
    message: 'Select the tweaks to apply',
    options: tweaks.map(({ description, name }) => ({ hint: description, label: name, value: name })),
    required: false,
  })

  if (typeof selected === 'symbol') {
    return resolvePromptCancellation(selected)
  }

  return tweaks.filter(({ name }) => selected.includes(name))
}
