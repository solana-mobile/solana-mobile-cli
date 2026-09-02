export const NO_CONNECTED_DEVICES_MESSAGE = 'No connected Android devices or emulators found'

/**
 * Ports we can put a name to. Purely cosmetic hints on the URL prompt — a reverse on an unknown port is
 * offered all the same, just without a description.
 */
export const KNOWN_DEVICE_PORTS: Record<number, string> = {
  4747: 'Solana Mobile Playground',
  8081: 'Metro / Expo dev server',
  8899: 'Solana RPC',
  8900: 'Solana WebSocket',
  18488: 'Surfpool Studio',
}

export function describeReverse({
  devicePort,
  hostPort,
}: {
  devicePort: number
  hostPort: number
}): string | undefined {
  const parts = [
    KNOWN_DEVICE_PORTS[devicePort],
    devicePort === hostPort ? undefined : `forwards to host port ${hostPort}`,
  ]
    .filter(Boolean)
    .join(', ')

  return parts || undefined
}
