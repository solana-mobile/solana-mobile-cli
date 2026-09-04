import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { AdbDependencies } from '../device/data-access/device-types.ts'
import { syncForwards } from './data-access/apply-forwards.ts'
import { inspectLocalnetContainer } from './data-access/docker-engine.ts'
import { localnetEndpoints, resolveLocalnetForContainer } from './data-access/localnet-engines.ts'
import type { LocalnetForwardCommandOptions } from './data-access/localnet-types.ts'
import { createInterruptSignal, watchForwards } from './data-access/watch-forwards.ts'
import { DEVICES_HEADING, devicesMessage, endpointsMessage } from './ui/localnet-ui-messages.ts'
import { renderDevicesHeading, renderForwards } from './ui/localnet-ui-render-forwards.ts'

export interface RunLocalnetForwardDependencies extends AdbDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  signal?: AbortSignal
}

export async function runLocalnetForward(
  options: LocalnetForwardCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    runCommand = runExecutable,
    signal,
  }: RunLocalnetForwardDependencies = {},
) {
  try {
    showIntro('solana-mobile localnet forward')

    // Forwarding has to target the ports the container actually published, or the reverses point at a
    // host port nothing is listening on.
    const localnet = resolveLocalnetForContainer(await inspectLocalnetContainer({ runCommand }), options)
    // Endpoints first, matching `localnet start`. `forward` does not probe the validator, so it cannot
    // claim it is ready — only that these are the endpoints it wired up.
    showNote(endpointsMessage(localnetEndpoints(localnet)), 'Endpoints')
    showNote(devicesMessage({ holding: Boolean(options.watch), watching: Boolean(options.watch) }), DEVICES_HEADING)

    const { actions, devices } = await syncForwards({ devices: options.devices, ports: localnet.ports }, { runCommand })

    renderForwards(actions, devices)

    if (options.watch) {
      await watchForwards(
        {
          devices: options.devices,
          onError: (error) => log(`Retrying after adb error: ${error}`),
          onSync: ({ actions: synced, devices: current }) => {
            renderDevicesHeading()
            renderForwards(synced, current)
          },
          ports: localnet.ports,
          signal: signal ?? createInterruptSignal(),
        },
        { runCommand },
      )
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
