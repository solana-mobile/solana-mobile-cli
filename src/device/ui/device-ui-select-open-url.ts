import { select, text } from '@clack/prompts'
import { resolvePromptCancellation, type SelectPrompt, type TextPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import type { AdbReverseEntry } from '../data-access/device-types.ts'
import { resolveOpenUrl, validateOpenUrlInput } from '../data-access/resolve-open-url.ts'
import { describeReverse } from './device-ui-messages.ts'

/** Cannot collide with a real choice: every reverse option is an `http://` URL. */
const ENTER_URL_VALUE = 'enter-url'

/**
 * The device's existing reverses are the localhost ports it can actually reach, which makes them the
 * honest suggestion list — after `localnet forward`, the Studio UI shows up here because a reverse
 * exists, not because it is privileged. Free-text entry is always the last option so a device with no
 * reverses is not a dead end.
 */
export async function selectOpenUrl(
  reverses: readonly AdbReverseEntry[],
  {
    runSelect = select as SelectPrompt,
    runText = text as TextPrompt,
  }: { runSelect?: SelectPrompt; runText?: TextPrompt } = {},
): Promise<string | undefined> {
  if (reverses.length > 0) {
    const selected = await runSelect({
      message: 'Select a URL to open on the device',
      options: [
        ...reverses.map((reverse) => createReverseOption(reverse)),
        { label: 'Enter a URL or port', value: ENTER_URL_VALUE },
      ],
    })

    if (typeof selected === 'symbol') {
      return resolvePromptCancellation(selected)
    }

    if (selected !== ENTER_URL_VALUE) {
      return selected
    }
  }

  const entered = await runText({
    message: 'URL or port to open on the device',
    placeholder: 'http://localhost:3000',
    validate: validateOpenUrlInput,
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return resolveOpenUrl(entered)
}

function createReverseOption(reverse: AdbReverseEntry) {
  return {
    hint: describeReverse(reverse),
    label: `http://localhost:${reverse.devicePort}`,
    value: `http://localhost:${reverse.devicePort}`,
  }
}
