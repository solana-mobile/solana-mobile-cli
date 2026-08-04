export const DEVICES_HEADING = 'Devices'

export const VALIDATOR_HEADING = 'Validator'

export const NO_DEVICES_MESSAGE = 'No Android devices or emulators are connected.'

export const DOCKER_UNAVAILABLE_MESSAGE = 'Docker is not running. Start Docker and try again.'

export const WAITING_FOR_RPC_MESSAGE = 'Waiting for the validator to accept RPC'

export const PORT_CONFLICT_HINT_MESSAGE =
  'If another process is using these ports, stop it or choose different host ports with --port.'

export function attachedMessage(rpcUrl: string, version?: string): string {
  return `Found a validator already running on ${rpcUrl}${version ? ` (${version})` : ''}. Not starting a container.`
}

/**
 * Shown instead of removing a container that carries no management label. Naming the command keeps the
 * user unblocked without us destroying something we did not create.
 */
export function unmanagedContainerMessage(containerName: string): string {
  return [
    `A container named ${containerName} exists but was not created by solana-mobile localnet.`,
    `Leaving it alone. Remove it yourself with: docker rm --force ${containerName}`,
  ].join('\n')
}

export const RPC_UNREACHABLE_HINT_MESSAGE =
  'The validator is not answering on the host. Start it with: solana-mobile localnet start'

export const MISSING_FORWARDS_HINT_MESSAGE =
  'Some devices have no reverse for these ports. Add them with: solana-mobile localnet forward'

/**
 * Android blocks cleartext HTTP by default from API 28, including to localhost. Shown when every leg
 * passes, because that is exactly when a still-failing app is most likely hitting this — and the
 * app-side error is opaque.
 */
export const CLEARTEXT_HINT_MESSAGE = [
  'If the tunnel is up but your app still cannot connect, check cleartext HTTP.',
  'Android blocks http:// by default from API 28. Allow it for local development with',
  'android:usesCleartextTraffic="true" or a network security config in AndroidManifest.xml.',
].join('\n')

export function validatorReadyTitle(version?: string): string {
  return version ? `Validator ready (${version})` : 'Validator ready'
}

/**
 * Body of the Devices note. Lines are broken by hand because `note` sizes its box to the longest line
 * instead of wrapping, so one long sentence overflows narrow terminals and splits mid-word.
 */
export function devicesMessage({ holding, watching }: { holding: boolean; watching: boolean }): string {
  const lines = watching
    ? ['Watching for devices. Forwards are re-applied', 'when a device connects, reconnects, or reboots.']
    : ['Forwards are applied once. They are lost when a', 'device reconnects or reboots.']

  return (holding ? [...lines, '', 'Press Ctrl-C to stop localnet.'] : lines).join('\n')
}

/**
 * Lists the endpoints and nothing else. Which env var to set is the app's business — it differs per
 * project and per framework — so we print the URLs and let people wire them up.
 *
 * The extra line only appears when `--port` moved a host port, because that is the one case where the
 * app-facing URL and the URL from this computer differ.
 */
export function endpointsMessage(
  endpoints: readonly { hostFacing: boolean; hostUrl: string; label: string; url: string }[],
): string {
  const width = Math.max(...endpoints.map(({ label }) => label.length))
  const lines = endpoints.map(({ label, url }) => `${label.padEnd(width)}  ${url}`)
  const moved = endpoints.filter(({ hostFacing, hostUrl, url }) => !hostFacing && hostUrl !== url)

  if (moved.length > 0) {
    lines.push('', `From this computer: ${moved.map(({ hostUrl, label }) => `${label} ${hostUrl}`).join(', ')}`)
  }

  return lines.join('\n')
}
