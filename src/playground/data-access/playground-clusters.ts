import { localnetDeviceRpcUrl, resolveLocalnet } from '../../localnet/data-access/localnet-engines.ts'
import type { PlaygroundClusterId, PlaygroundCommandOptions, PlaygroundConfig } from './playground-types.ts'

/**
 * Device-side port the playground page is served on. Canonical in the localnet sense: `--port` moves the
 * host side while the device always opens `http://localhost:4747`.
 */
export const PLAYGROUND_DEVICE_PORT = 4747

export const DEFAULT_PLAYGROUND_CLUSTER: PlaygroundClusterId = 'devnet'

export interface PlaygroundCluster {
  /** MWA chain identifier. MWA knows no localnet, so localnet authorizes as devnet and only the RPC moves. */
  chain: string
  id: PlaygroundClusterId
  label: string
  rpcUrl: string
}

export const PLAYGROUND_CLUSTERS: Record<PlaygroundClusterId, PlaygroundCluster> = {
  devnet: {
    chain: 'solana:devnet',
    id: 'devnet',
    label: 'Devnet',
    rpcUrl: 'https://api.devnet.solana.com',
  },
  localnet: {
    chain: 'solana:devnet',
    id: 'localnet',
    label: 'Localnet',
    // The device-side URL: the reverse created by `solana-mobile localnet` makes it reachable there.
    rpcUrl: localnetDeviceRpcUrl(resolveLocalnet()),
  },
  mainnet: {
    chain: 'solana:mainnet',
    id: 'mainnet',
    label: 'Mainnet',
    // No default endpoint: the public mainnet RPC does not allow browser access, so mainnet is only
    // enabled when the user supplies their own browser-reachable endpoint with `--url`.
    rpcUrl: '',
  },
  testnet: {
    chain: 'solana:testnet',
    id: 'testnet',
    label: 'Testnet',
    rpcUrl: 'https://api.testnet.solana.com',
  },
}

export function isPlaygroundClusterId(value: string | undefined): value is PlaygroundClusterId {
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `toString`/`constructor` would be
  // accepted as cluster ids and resolve to inherited `Object.prototype` members.
  return value !== undefined && Object.hasOwn(PLAYGROUND_CLUSTERS, value)
}

export function parsePlaygroundClusterId(value: string): PlaygroundClusterId {
  if (isPlaygroundClusterId(value)) {
    return value
  }

  throw new Error(`Unknown cluster: ${value}. Expected one of: ${Object.keys(PLAYGROUND_CLUSTERS).join(', ')}`)
}

/** `--url` overrides the RPC endpoint while the MWA chain id stays with the selected cluster. */
export function resolvePlaygroundCluster({
  cluster = DEFAULT_PLAYGROUND_CLUSTER,
  url,
}: Pick<PlaygroundCommandOptions, 'cluster' | 'url'> = {}): PlaygroundCluster {
  const resolved = PLAYGROUND_CLUSTERS[cluster]

  return url ? { ...resolved, rpcUrl: url } : resolved
}

export function playgroundConfig(cluster: PlaygroundCluster): PlaygroundConfig {
  return { chain: cluster.chain, cluster: cluster.id, rpcUrl: cluster.rpcUrl }
}
