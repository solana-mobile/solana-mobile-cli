import type { CommandRunner } from '../../core/data-access/command-types.ts'

export type LocalnetEngineId = 'surfpool' | 'test-validator'

export type LocalnetNetworkId = 'devnet' | 'mainnet' | 'testnet'

/**
 * Remote cluster the validator forks from, lazily (surfpool) or by cloning up front (test-validator).
 * Discriminated on `kind` so every consumer handles both sources; no datasource means an offline chain.
 */
export type LocalnetDatasource =
  | { clone: string[]; cloneUpgradeableProgram: string[]; kind: 'network'; network: LocalnetNetworkId }
  | { clone: string[]; cloneUpgradeableProgram: string[]; kind: 'rpc-url'; rpcUrl: string }

export interface LocalnetDatasourceOptions {
  clone?: string[]
  cloneUpgradeableProgram?: string[]
  network?: LocalnetNetworkId
  rpcUrl?: string
}

/** Ports we know how to forward. Each engine declares the subset it serves. */
export type LocalnetPortName = 'rpc' | 'studio' | 'ws'

export interface LocalnetEnginePort {
  /**
   * The port inside the container, which is also the port the device sees. Keeping this fixed is what
   * lets `--port` move the host side without changing app configuration.
   */
  canonical: number
  name: LocalnetPortName
}

export interface LocalnetEngine {
  /** Container command arguments, built from the canonical (container-side) ports. */
  buildArgs: (ports: Record<LocalnetPortName, number | undefined>, datasource?: LocalnetDatasource) => string[]
  environment: Record<string, string>
  id: LocalnetEngineId
  image: string
  ports: LocalnetEnginePort[]
  /** The solana-test-validator image requires privileged mode. */
  privileged?: boolean
}

export interface ResolvedLocalnetPort {
  /** Port on the device (and inside the container). */
  canonical: number
  /** Port published on the host. */
  host: number
  name: LocalnetPortName
}

export interface ResolvedLocalnet {
  datasource?: LocalnetDatasource
  engine: LocalnetEngine
  image: string
  ports: ResolvedLocalnetPort[]
}

export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | (string & {})

export interface AdbDevice {
  serial: string
  state: AdbDeviceState
}

export interface AdbReverseEntry {
  /** Port the device listens on. This is the key `adb reverse --remove` takes. */
  devicePort: number
  /** Port the connection is forwarded to on the host. */
  hostPort: number
}

export type ForwardActionKind = 'create' | 'keep' | 'replace'

export interface ForwardAction {
  devicePort: number
  hostPort: number
  kind: ForwardActionKind
  name: LocalnetPortName
  serial: string
}

export interface ContainerStatus {
  /**
   * The datasource label the container was started with, so a later `start` can tell whether the running
   * validator already forks from what was asked for. Absent means offline (or a pre-datasource container).
   */
  datasource?: string
  /**
   * Read back from the container label, so `status`/`stop` work without repeating `--engine`. Only set
   * for a recognized engine id, which also makes it the proof that we created this container.
   */
  engine?: LocalnetEngineId
  health?: string
  name: string
  /**
   * Host ports the container was actually published on, keyed by canonical (container-side) port. Read
   * back so lifecycle commands act on the session that was started rather than on defaults.
   */
  publishedPorts?: Record<number, number>
  running: boolean
  status?: string
}

export interface RpcProbeResult {
  error?: string
  ok: boolean
  version?: string
}

export interface DevicePortProbeResult {
  devicePort: number
  /** Host port the reverse is expected to point at, so a misrouted tunnel is visible in the report. */
  hostPort?: number
  name: LocalnetPortName
  ok: boolean
  reason?: string
}

export interface DeviceCheckResult {
  ports: DevicePortProbeResult[]
  serial: string
  state: AdbDeviceState
}

export interface LocalnetCheckReport {
  devices: DeviceCheckResult[]
  engine: LocalnetEngineId
  ok: boolean
  rpc: RpcProbeResult
  rpcUrl: string
}

export interface LocalnetStatusReport {
  container: ContainerStatus
  devices: { forwards: AdbReverseEntry[]; serial: string; state: AdbDeviceState }[]
  engine: LocalnetEngineId
  rpcUrl: string
}

export interface LocalnetPortOptions {
  port?: number
  studioPort?: number
  wsPort?: number
}

export interface LocalnetCheckCommandOptions extends LocalnetPortOptions {
  devices?: string[]
  engine?: LocalnetEngineId
  json?: boolean
  open?: boolean
}

export interface LocalnetForwardCommandOptions extends LocalnetPortOptions {
  devices?: string[]
  engine?: LocalnetEngineId
  watch?: boolean
}

export interface LocalnetLogsCommandOptions {
  follow?: boolean
  lines?: number
}

export interface LocalnetStartCommandOptions extends LocalnetDatasourceOptions, LocalnetPortOptions {
  detach?: boolean
  devices?: string[]
  engine?: LocalnetEngineId
  image?: string
  watch?: boolean
}

export interface LocalnetStatusCommandOptions extends LocalnetPortOptions {
  devices?: string[]
  engine?: LocalnetEngineId
  json?: boolean
}

export interface LocalnetStopCommandOptions extends LocalnetPortOptions {
  devices?: string[]
  engine?: LocalnetEngineId
}

/** A reverse this process created or replaced, and is therefore responsible for tearing down. */
export interface OwnedForward {
  devicePort: number
  serial: string
}

export interface AdbDependencies {
  runCommand?: CommandRunner
}

export interface DockerDependencies {
  /**
   * Container to operate on. Defaults to the one localnet manages; the integration tests override it so
   * running them never touches a real `solana-mobile localnet` session.
   */
  containerName?: string
  runCommand?: CommandRunner
}

export type JsonRpcFetcher = (url: string, method: string) => Promise<unknown>
