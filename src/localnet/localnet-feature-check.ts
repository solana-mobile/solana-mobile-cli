import { cancel, intro, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { AdbDependencies, AdbReverseEntry } from '../device/data-access/device-types.ts'
import { isUsableDevice, listAdbDevices } from '../device/data-access/list-adb-devices.ts'
import { openUrlOnDevice } from '../device/data-access/open-url-on-device.ts'
import { collectExistingReverses } from './data-access/apply-forwards.ts'
import { inspectLocalnetContainer } from './data-access/docker-engine.ts'
import { findLocalnetPort, localnetRpcUrl, resolveLocalnetForContainer } from './data-access/localnet-engines.ts'
import type {
  DeviceCheckResult,
  DevicePortProbeResult,
  JsonRpcFetcher,
  LocalnetCheckCommandOptions,
  LocalnetCheckReport,
  ResolvedLocalnet,
  ResolvedLocalnetPort,
} from './data-access/localnet-types.ts'
import { matchReverse } from './data-access/plan-forwards.ts'
import { probeDevicePort } from './data-access/probe-device-port.ts'
import { defaultJsonRpcFetcher, probeRpc } from './data-access/probe-rpc.ts'
import { renderLocalnetCheck } from './ui/localnet-ui-render-check.ts'

export interface RunLocalnetCheckDependencies extends AdbDependencies {
  cancel?: (message: string) => void
  fetchJsonRpc?: JsonRpcFetcher
  intro?: (message: string) => void
  outro?: (message: string) => void
}

/**
 * Verifies one device port in two steps: the reverse table has to name our exact host port, and the
 * tunnel has to carry traffic. The mapping check comes first because it is the only one that can catch a
 * misrouted reverse — see `matchReverse`.
 */
export async function checkDevicePort(
  serial: string,
  port: ResolvedLocalnetPort,
  entries: readonly AdbReverseEntry[] | undefined,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<DevicePortProbeResult> {
  const match = matchReverse(entries, port)

  if (match.kind !== 'match') {
    return {
      devicePort: port.canonical,
      hostPort: port.host,
      name: port.name,
      ok: false,
      reason:
        match.kind === 'missing'
          ? 'no reverse on device'
          : `reverse points at host port ${match.hostPort}, expected ${port.host}`,
    }
  }

  return { ...(await probeDevicePort(serial, port, { runCommand })), hostPort: port.host }
}

/**
 * Two-legged verification. The host leg is a real JSON-RPC call proving the validator is alive; the
 * device leg proves the tunnel both points at that validator and carries traffic. Neither alone covers
 * the path, and the device leg cannot be an RPC call because Android has no HTTP client.
 */
export async function createLocalnetCheckReport(
  localnet: ResolvedLocalnet,
  options: LocalnetCheckCommandOptions = {},
  { fetchJsonRpc = defaultJsonRpcFetcher, runCommand = runExecutable }: RunLocalnetCheckDependencies = {},
): Promise<LocalnetCheckReport> {
  const rpcUrl = localnetRpcUrl(localnet)
  const rpc = await probeRpc(rpcUrl, { fetchJsonRpc })
  const all = await listAdbDevices({ runCommand })
  const selected = options.devices?.length ? all.filter(({ serial }) => options.devices?.includes(serial)) : all
  const existing = await collectExistingReverses(selected, { runCommand })

  const devices: DeviceCheckResult[] = await Promise.all(
    selected.map(async (device) => ({
      ports: isUsableDevice(device)
        ? await Promise.all(
            localnet.ports.map((port) =>
              checkDevicePort(device.serial, port, existing.get(device.serial), { runCommand }),
            ),
          )
        : [],
      serial: device.serial,
      state: device.state,
    })),
  )

  return {
    devices,
    engine: localnet.engine.id,
    ok: rpc.ok && devices.length > 0 && devices.every(({ ports }) => ports.length > 0 && ports.every(({ ok }) => ok)),
    rpc,
    rpcUrl,
  }
}

export async function runLocalnetCheck(
  options: LocalnetCheckCommandOptions = {},
  dependencies: RunLocalnetCheckDependencies = {},
) {
  const {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    outro: showOutro = outro,
    runCommand = runExecutable,
  } = dependencies

  try {
    // The running container knows its engine and host ports, so `check` verifies the session that was
    // actually started instead of whatever the defaults happen to be.
    const container = await inspectLocalnetContainer({ runCommand })
    const localnet = resolveLocalnetForContainer(container, options)
    const report = await createLocalnetCheckReport(localnet, options, dependencies)

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      showIntro('solana-mobile localnet check')
      renderLocalnetCheck(report)
    }

    if (options.open) {
      const studio = findLocalnetPort(localnet, 'studio')

      for (const { serial } of report.devices.filter(({ state }) => state === 'device')) {
        // Best effort: a fresh emulator shows the browser's first-run screen instead of the page.
        await openUrlOnDevice(serial, `http://localhost:${studio?.canonical ?? 18488}`, { runCommand }).catch(() => {})
      }
    }

    if (!options.json) {
      showOutro(report.ok ? 'Localnet is reachable from every device' : 'Localnet is not fully reachable')
    }

    process.exitCode = report.ok ? 0 : 1
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
