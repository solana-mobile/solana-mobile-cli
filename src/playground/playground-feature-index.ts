import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { connectedDeviceLabel, listConnectedDevices } from '../device/data-access/list-connected-devices.ts'
import { NO_CONNECTED_DEVICES_MESSAGE } from '../device/ui/device-ui-messages.ts'
import { resolveTargetDevice } from '../device/ui/device-ui-resolve-target-device.ts'
import type { PromptDependencies } from '../emulator/ui/emulator-ui-prompt-types.ts'
import { createAdbReverse, listAdbReverses, removeAdbReverse } from '../localnet/data-access/adb-reverse.ts'
import { isUsableDevice } from '../localnet/data-access/list-adb-devices.ts'
import { localnetRpcUrl, resolveLocalnet } from '../localnet/data-access/localnet-engines.ts'
import type { AdbDependencies } from '../localnet/data-access/localnet-types.ts'
import { openUrlOnDevice } from '../localnet/data-access/probe-device-port.ts'
import { probeRpc } from '../localnet/data-access/probe-rpc.ts'
import {
  PLAYGROUND_DEVICE_PORT,
  playgroundConfig,
  resolvePlaygroundCluster,
} from './data-access/playground-clusters.ts'
import { loadPlaygroundPage } from './data-access/playground-page.ts'
import { startPlaygroundServer } from './data-access/playground-server.ts'
import type { PlaygroundCommandOptions } from './data-access/playground-types.ts'
import { renderPlaygroundEvent } from './ui/playground-ui-messages.ts'

export { parsePlaygroundClusterId } from './data-access/playground-clusters.ts'
export type { PlaygroundClusterId, PlaygroundCommandOptions } from './data-access/playground-types.ts'

interface RunPlaygroundDependencies extends AdbDependencies, PromptDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  loadPage?: typeof loadPlaygroundPage
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  probeLocalnetRpc?: typeof probeRpc
  /** Resolves when the playground should shut down. Defaults to the first SIGINT or SIGTERM. */
  waitForStop?: () => Promise<void>
}

export async function runPlayground(
  options: PlaygroundCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    loadPage = loadPlaygroundPage,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    probeLocalnetRpc = probeRpc,
    runCommand = runExecutable,
    runSelect,
    waitForStop = waitForShutdownSignal,
  }: RunPlaygroundDependencies = {},
) {
  try {
    showIntro('solana-mobile playground')

    const verboseLog = (message: string) => {
      if (options.verbose) {
        log(message)
      }
    }

    const cluster = resolvePlaygroundCluster(options)

    // Mainnet ships no default endpoint (the public RPC blocks browser access), so it is only usable
    // with a `--url` the caller provides. Fail fast before touching devices.
    if (!cluster.rpcUrl) {
      showNote(
        formatCommand(`playground --cluster ${cluster.id} --url <https rpc>`),
        `${cluster.label} has no browser-accessible public RPC — pass your own endpoint with --url`,
      )
      showOutro('Done')
      process.exitCode = 1
      return
    }

    const devices = (await listConnectedDevices({ runCommand })).filter(isUsableDevice)
    const device = await resolveTargetDevice(devices, options.device, { runSelect })

    if (device === undefined) {
      if (devices.length === 0) {
        showNote(formatCommand('emulator start'), NO_CONNECTED_DEVICES_MESSAGE)
        showOutro('Done')
        process.exitCode = 1
      }

      return
    }

    if (!options.device && devices.length === 1) {
      log(`Using device: ${connectedDeviceLabel(device)}`)
    }

    log(`Cluster: ${cluster.label} (${cluster.chain}), RPC ${cluster.rpcUrl}`)

    if (cluster.id === 'localnet') {
      const probe = await probeLocalnetRpc(localnetRpcUrl(resolveLocalnet()))

      if (!probe.ok) {
        showNote(formatCommand('localnet'), 'Localnet RPC is not reachable — start it with')
      }
    }

    const page = loadPage()
    const server = await startPlaygroundServer({
      config: playgroundConfig(cluster),
      onEvent: (event) => log(renderPlaygroundEvent(event)),
      onPageLoad: () => verboseLog('Page loaded on the device'),
      page,
      port: options.port ?? PLAYGROUND_DEVICE_PORT,
      strictPort: options.port !== undefined,
    })

    if (server.port !== (options.port ?? PLAYGROUND_DEVICE_PORT)) {
      verboseLog(`Port ${options.port ?? PLAYGROUND_DEVICE_PORT} is busy, serving on ${server.port} instead`)
    }

    // Once the server is listening it owns a host port (and, in a moment, an adb reverse), so everything
    // from here runs under a finally that always releases both — a failure to forward or open must not
    // leak the server or a dangling reverse.
    let createdReverse = false

    try {
      // The device port never moves, so the page URL on the device is stable no matter where the host
      // side lands — the same canonical-vs-host split localnet uses.
      const reverses = await listAdbReverses(device.serial, { runCommand })
      const existing = reverses.find((reverse) => reverse.devicePort === PLAYGROUND_DEVICE_PORT)

      if (existing && existing.hostPort !== server.port) {
        verboseLog(`Replacing the existing reverse to host port ${existing.hostPort}`)
      }

      if (existing?.hostPort !== server.port) {
        await createAdbReverse(
          device.serial,
          { devicePort: PLAYGROUND_DEVICE_PORT, hostPort: server.port },
          { runCommand },
        )
        createdReverse = true
      }

      log(`Forwarded device port ${PLAYGROUND_DEVICE_PORT} to host port ${server.port}`)

      const deviceUrl = `http://localhost:${PLAYGROUND_DEVICE_PORT}`

      if (options.open === false) {
        log(`Open ${deviceUrl} on the device (host: http://localhost:${server.port})`)
      } else {
        await openUrlOnDevice(device.serial, deviceUrl, { runCommand })
        log(`Opened ${deviceUrl} on ${connectedDeviceLabel(device)}`)
      }

      log('Waiting for wallet interactions — press Ctrl+C to stop')

      await waitForStop()
    } finally {
      // Best-effort teardown: only remove the reverse we created (a pre-existing one may be someone
      // else's), and the device may already be gone by the time the playground stops.
      if (createdReverse) {
        try {
          await removeAdbReverse(device.serial, PLAYGROUND_DEVICE_PORT, { runCommand })
        } catch (error) {
          verboseLog(`Could not remove the reverse: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Guarded like the reverse removal: a rejection here must not replace the error that sent us into
      // this finally (a throw from finally supersedes the in-flight exception).
      try {
        await server.close()
      } catch (error) {
        verboseLog(`Could not close the server: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      resolve()
    }

    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  })
}
