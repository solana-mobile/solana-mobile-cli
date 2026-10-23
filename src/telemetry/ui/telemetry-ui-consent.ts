import { confirm, isCancel, note } from '@clack/prompts'

export const TELEMETRY_DOCS_URL = 'https://github.com/solana-mobile/solana-mobile-cli#telemetry'

// Cancelling counts as a no: the question was seen, and asking again on every run would nag
export async function promptTelemetryConsent(): Promise<boolean> {
  note(
    [
      'Help improve solana-mobile by sending anonymous usage data:',
      'which commands and templates you use, crashes, and your OS and CLI version.',
      'No paths, project names, wallet addresses or keys are ever sent.',
      `Details: ${TELEMETRY_DOCS_URL}`,
      'Change it any time with `solana-mobile telemetry enable|disable`.',
    ].join('\n'),
    'Telemetry',
  )

  const answer = await confirm({ initialValue: false, message: 'Send anonymous usage data?' })

  return !isCancel(answer) && answer
}
