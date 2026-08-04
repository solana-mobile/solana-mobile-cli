import type {
  ContainerStatus,
  LocalnetEngine,
  LocalnetEngineId,
  LocalnetPortName,
  LocalnetPortOptions,
  ResolvedLocalnet,
  ResolvedLocalnetPort,
} from './localnet-types.ts'

export const LOCALNET_CONTAINER_NAME = 'solana-mobile-localnet'

/**
 * Records which engine a container is running, so `status` and `stop` work without repeating `--engine`.
 * Deliberately not reverse-DNS: that form claims ownership of a domain we do not own.
 */
export const LOCALNET_ENGINE_LABEL = 'localnet.engine'

export const DEFAULT_LOCALNET_ENGINE: LocalnetEngineId = 'surfpool'

/**
 * Container contracts mirror `@beeman/testcontainers`, which is the known-good configuration for both
 * images. Both images ship a HEALTHCHECK, so readiness comes from `docker inspect` rather than log
 * scraping.
 */
export const LOCALNET_ENGINES: Record<LocalnetEngineId, LocalnetEngine> = {
  surfpool: {
    buildArgs: ({ rpc, studio, ws }) => [
      'start',
      '--no-tui',
      '--host',
      '0.0.0.0',
      ...(rpc ? ['--port', String(rpc)] : []),
      ...(ws ? ['--ws-port', String(ws)] : []),
      ...(studio ? ['--studio-port', String(studio)] : []),
      '--offline',
    ],
    environment: { SURFPOOL_NETWORK_HOST: '0.0.0.0' },
    id: 'surfpool',
    image: 'surfpool/surfpool:latest',
    ports: [
      { canonical: 8899, name: 'rpc' },
      { canonical: 8900, name: 'ws' },
      { canonical: 18488, name: 'studio' },
    ],
  },
  'test-validator': {
    // The image starts the validator through its own entrypoint; no arguments needed.
    buildArgs: () => [],
    environment: {},
    id: 'test-validator',
    image: 'beeman/solana-test-validator:latest',
    ports: [
      { canonical: 8899, name: 'rpc' },
      { canonical: 8900, name: 'ws' },
    ],
    privileged: true,
  },
}

export function isLocalnetEngineId(value: string | undefined): value is LocalnetEngineId {
  return value === 'surfpool' || value === 'test-validator'
}

export function parseLocalnetEngineId(value: string): LocalnetEngineId {
  if (isLocalnetEngineId(value)) {
    return value
  }

  throw new Error(`Unknown localnet engine: ${value}. Expected one of: surfpool, test-validator`)
}

/** Maps a port to the command line option that overrides its host side. */
export const PORT_OPTION_KEYS: Record<LocalnetPortName, keyof LocalnetPortOptions> = {
  rpc: 'port',
  studio: 'studioPort',
  ws: 'wsPort',
}

/**
 * Resolves host ports for an engine. Canonical ports never move: overriding `--port` republishes the
 * container on a different host port while the device keeps seeing the canonical one.
 */
export function resolveLocalnet(
  engineId: LocalnetEngineId = DEFAULT_LOCALNET_ENGINE,
  { image, ports = {} }: { image?: string; ports?: LocalnetPortOptions } = {},
): ResolvedLocalnet {
  const engine = LOCALNET_ENGINES[engineId]

  return {
    engine,
    image: image ?? engine.image,
    ports: engine.ports.map(({ canonical, name }) => ({
      canonical,
      host: ports[PORT_OPTION_KEYS[name]] ?? canonical,
      name,
    })),
  }
}

/** First defined value per port wins, so callers can express precedence by argument order. */
export function mergePortOptions(...sources: (LocalnetPortOptions | undefined)[]): LocalnetPortOptions {
  const merged: LocalnetPortOptions = {}

  for (const key of Object.values(PORT_OPTION_KEYS)) {
    merged[key] = sources.find((source) => source?.[key] !== undefined)?.[key]
  }

  return merged
}

/** Turns the host bindings read back from a container into the same shape the options use. */
export function publishedPortOptions(
  engineId: LocalnetEngineId,
  published: Record<number, number> | undefined,
): LocalnetPortOptions {
  const options: LocalnetPortOptions = {}

  for (const { canonical, name } of LOCALNET_ENGINES[engineId].ports) {
    const host = published?.[canonical]

    if (host !== undefined) {
      options[PORT_OPTION_KEYS[name]] = host
    }
  }

  return options
}

export function engineConflictMessage(running: LocalnetEngineId, requested: LocalnetEngineId): string {
  return `A ${running} container is already running. Stop it with \`solana-mobile localnet stop\` before using ${requested}.`
}

/**
 * Resolves what a lifecycle command should act on, in precedence order: explicit options, then whatever
 * the container was actually started with, then defaults.
 *
 * The container leg is what makes `--engine` and `--port` stick for a detached session: without it,
 * `localnet start --detach --engine test-validator --port 9899` followed by a plain `localnet status`
 * would report surfpool on 8899 — advertising a Studio endpoint that engine does not even serve.
 *
 * `runningOnly` is for `start`, which is about to replace a stopped container and so must not inherit
 * its configuration; every other command acts on the existing session and inherits either way.
 */
export function resolveLocalnetForContainer(
  container: ContainerStatus,
  options: { engine?: LocalnetEngineId; image?: string } & LocalnetPortOptions = {},
  { runningOnly = false }: { runningOnly?: boolean } = {},
): ResolvedLocalnet {
  // Only a *running* container conflicts: reusing it as a different engine would advertise endpoints it
  // does not serve. A stopped one is either about to be replaced or is not serving anything at all.
  if (options.engine && container.running && container.engine && options.engine !== container.engine) {
    throw new Error(engineConflictMessage(container.engine, options.engine))
  }

  const inherit = runningOnly ? container.running : container.status !== undefined
  const engineId = options.engine ?? (inherit ? container.engine : undefined) ?? DEFAULT_LOCALNET_ENGINE

  return resolveLocalnet(engineId, {
    image: options.image,
    ports: mergePortOptions(options, inherit ? publishedPortOptions(engineId, container.publishedPorts) : undefined),
  })
}

export function findLocalnetPort(
  { ports }: Pick<ResolvedLocalnet, 'ports'>,
  name: LocalnetPortName,
): ResolvedLocalnetPort | undefined {
  return ports.find((port) => port.name === name)
}

/** RPC URL as seen from this computer. Used by the host leg of `check` and by host-side tooling. */
export function localnetRpcUrl(localnet: ResolvedLocalnet): string {
  return `http://localhost:${findLocalnetPort(localnet, 'rpc')?.host ?? 8899}`
}

/**
 * RPC URL as seen from inside the device, which is the one an app should be configured with. It uses the
 * canonical port, so `--port` can move the host side without touching app configuration.
 */
export function localnetDeviceRpcUrl(localnet: ResolvedLocalnet): string {
  return `http://localhost:${findLocalnetPort(localnet, 'rpc')?.canonical ?? 8899}`
}

/**
 * `attach` uses a validator someone else is already running, `reuse` waits on our own container, and
 * `start` creates one. Attaching matters because a validator already bound to these ports would make
 * `docker run` fail on the port bind — and because it lets a natively-run validator work with no Docker.
 */
export type EngineAction = 'attach' | 'reuse' | 'start'

export function planEngineAction({
  containerRunning,
  rpcReachable,
}: {
  containerRunning: boolean
  rpcReachable: boolean
}): EngineAction {
  // Our own container wins: when it is up, the RPC answering is that container, not a third party.
  if (containerRunning) {
    return 'reuse'
  }

  return rpcReachable ? 'attach' : 'start'
}

const ENDPOINT_LABELS: Record<LocalnetPortName, string> = { rpc: 'RPC', studio: 'Studio', ws: 'WS' }

/** Studio is opened in a browser on this computer; RPC and WS are consumed by the app on the device. */
const HOST_FACING_PORTS: LocalnetPortName[] = ['studio']

export interface LocalnetEndpoint {
  hostFacing: boolean
  hostUrl: string
  label: string
  name: LocalnetPortName
  /** The URL for whoever actually uses this endpoint. */
  url: string
}

/**
 * Builds the URLs worth printing, each pointed at its real consumer. This matters once `--port` moves the
 * host side: the app needs the device URL, while Studio is something the developer opens locally.
 */
export function localnetEndpoints({ ports }: Pick<ResolvedLocalnet, 'ports'>): LocalnetEndpoint[] {
  return ports.map(({ canonical, host, name }) => {
    const hostFacing = HOST_FACING_PORTS.includes(name)
    const scheme = name === 'ws' ? 'ws' : 'http'

    return {
      hostFacing,
      hostUrl: `${scheme}://localhost:${host}`,
      label: ENDPOINT_LABELS[name],
      name,
      url: `${scheme}://localhost:${hostFacing ? host : canonical}`,
    }
  })
}

export function canonicalPorts({
  ports,
}: Pick<ResolvedLocalnet, 'ports'>): Record<LocalnetPortName, number | undefined> {
  return {
    rpc: ports.find((port) => port.name === 'rpc')?.canonical,
    studio: ports.find((port) => port.name === 'studio')?.canonical,
    ws: ports.find((port) => port.name === 'ws')?.canonical,
  }
}
