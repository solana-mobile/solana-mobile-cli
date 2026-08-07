import { runExecutable } from '../../core/data-access/run-executable.ts'
import {
  canonicalPorts,
  datasourceLabel,
  isLocalnetEngineId,
  LOCALNET_CONTAINER_NAME,
  LOCALNET_DATASOURCE_LABEL,
  LOCALNET_ENGINE_LABEL,
} from './localnet-engines.ts'
import type { ContainerStatus, DockerDependencies, ResolvedLocalnet } from './localnet-types.ts'

// `HostConfig.PortBindings` rather than `NetworkSettings.Ports`: the former is the configuration the
// container was created with and survives the container being stopped, which is exactly when `status`
// and `stop` still need to know which host ports the session used.
//
// The datasource label goes last because it can contain the separator (an RPC URL may carry `|`); the
// parser rejoins everything after the port bindings, which are JSON that never contains one.
const INSPECT_FORMAT = [
  '{{.State.Status}}',
  '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
  `{{index .Config.Labels "${LOCALNET_ENGINE_LABEL}"}}`,
  '{{json .HostConfig.PortBindings}}',
  `{{index .Config.Labels "${LOCALNET_DATASOURCE_LABEL}"}}`,
].join('|')

export async function isDockerRunning({ runCommand = runExecutable }: DockerDependencies = {}): Promise<boolean> {
  try {
    await runCommand(['docker', 'info', '--format', '{{.ServerVersion}}'])
    return true
  } catch {
    return false
  }
}

export async function inspectLocalnetContainer({
  containerName = LOCALNET_CONTAINER_NAME,
  runCommand = runExecutable,
}: DockerDependencies = {}): Promise<ContainerStatus> {
  try {
    const output = await runCommand(['docker', 'inspect', '--format', INSPECT_FORMAT, containerName])
    return parseContainerStatus(output, containerName)
  } catch {
    // `docker inspect` exits non-zero when the container does not exist.
    return { name: containerName, running: false }
  }
}

export function parseContainerStatus(output: string, containerName = LOCALNET_CONTAINER_NAME): ContainerStatus {
  const [status, health, label, bindings, ...datasourceParts] = output.trim().split('|')
  const datasource = datasourceParts.join('|')

  return {
    // `<no value>` is what docker prints for a missing label on older engines; empty means unset too.
    datasource: datasource && datasource !== '<no value>' ? datasource : undefined,
    // Only a recognized engine id counts, so `engine` doubles as proof that we created this container.
    engine: isLocalnetEngineId(label) ? label : undefined,
    health: health && health !== 'none' ? health : undefined,
    name: containerName,
    publishedPorts: parsePublishedPorts(bindings),
    running: status === 'running',
    status: status || undefined,
  }
}

/**
 * Reads Docker's own port bindings — `{"8899/tcp":[{"HostIp":"","HostPort":"9899"}]}` — into a map from
 * canonical to host port. Docker is the source of truth here: it cannot drift from what is bound.
 */
export function parsePublishedPorts(value: string | undefined): Record<number, number> | undefined {
  if (!value) {
    return undefined
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }

  const published: Record<number, number> = {}

  for (const [spec, hosts] of Object.entries(parsed as Record<string, unknown>)) {
    const canonical = Number(spec.split('/')[0])
    const first = Array.isArray(hosts) ? (hosts[0] as { HostPort?: string } | undefined) : undefined
    const host = Number(first?.HostPort)

    if (Number.isInteger(canonical) && canonical > 0 && Number.isInteger(host) && host > 0) {
      published[canonical] = host
    }
  }

  return Object.keys(published).length > 0 ? published : undefined
}

/**
 * Proof that we created a container, and therefore that removing it is ours to do. Anything else named
 * `solana-mobile-localnet` belongs to whoever made it.
 */
export function isManagedContainer({ engine, status }: ContainerStatus): boolean {
  return status !== undefined && engine !== undefined
}

export function buildDockerRunCommand(
  localnet: ResolvedLocalnet,
  { containerName = LOCALNET_CONTAINER_NAME }: { containerName?: string } = {},
): [string, ...string[]] {
  const { datasource, engine, image, ports } = localnet

  return [
    'docker',
    'run',
    '--detach',
    '--name',
    containerName,
    '--label',
    `${LOCALNET_ENGINE_LABEL}=${engine.id}`,
    ...(datasource ? ['--label', `${LOCALNET_DATASOURCE_LABEL}=${datasourceLabel(datasource)}`] : []),
    ...(engine.privileged ? ['--privileged'] : []),
    ...Object.entries(engine.environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    // Bound to loopback explicitly: `host:container` publishes on every interface, which would put the
    // validator's RPC, WS, and Studio on the LAN. The endpoints we advertise are localhost-only, and
    // `adb reverse` reaches them through the adb server on this host, so loopback is all that is needed.
    ...ports.flatMap(({ canonical, host }) => ['--publish', `127.0.0.1:${host}:${canonical}`]),
    image,
    ...engine.buildArgs(canonicalPorts(localnet), datasource),
  ]
}

export async function startLocalnetContainer(
  localnet: ResolvedLocalnet,
  { containerName = LOCALNET_CONTAINER_NAME, runCommand = runExecutable }: DockerDependencies = {},
): Promise<void> {
  await runCommand(buildDockerRunCommand(localnet, { containerName }))
}

export async function removeLocalnetContainer({
  containerName = LOCALNET_CONTAINER_NAME,
  runCommand = runExecutable,
}: DockerDependencies = {}): Promise<void> {
  await runCommand(['docker', 'rm', '--force', containerName])
}

export async function readLocalnetContainerLogs(
  { lines = 100 }: { lines?: number } = {},
  { containerName = LOCALNET_CONTAINER_NAME, runCommand = runExecutable }: DockerDependencies = {},
): Promise<string> {
  // Container stderr matters here: validators report startup failures on it, and dropping it would hide
  // exactly the diagnostics `logs` and the integration test's failure dump exist to surface.
  return runCommand(['docker', 'logs', '--tail', String(lines), containerName], { combineOutput: true })
}
