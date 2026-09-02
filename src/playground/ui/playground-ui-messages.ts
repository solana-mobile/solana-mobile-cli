import type { PlaygroundEvent, PlaygroundEventKind } from '../data-access/playground-types.ts'

const EVENT_LABELS: Record<PlaygroundEventKind, string> = {
  airdrop: 'Airdrop',
  connect: 'Connect',
  'sign-and-send': 'Sign and Send',
  'sign-in': 'Sign In',
  'sign-message': 'Sign Message',
  'sign-transaction': 'Sign Transaction',
}

export function renderPlaygroundEvent(event: PlaygroundEvent): string {
  const status = event.ok ? '✔' : '✖'
  const detail = event.detail ? ` — ${event.detail}` : ''

  return `${status} ${EVENT_LABELS[event.kind]}${detail}`
}
