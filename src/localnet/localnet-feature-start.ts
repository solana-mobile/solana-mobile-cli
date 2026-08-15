import { cancel, log as clackLog, intro, note, outro, spinner } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { syncForwards } from './data-access/apply-forwards.ts'
import {
  inspectLocalnetContainer,
  isDockerRunning,
  isManagedContainer,
  removeLocalnetContainer,
  startLocalnetContainer,
} from './data-access/docker-engine.ts'
import {
  localnetEndpoints,
  localnetRpcUrl,
  planEngineAction,
  resolveLocalnetForContainer,
} from './data-access/localnet-engines.ts'
import type {
  AdbDependencies,
  JsonRpcFetcher,
  LocalnetStartCommandOptions,
  OwnedForward,
  ResolvedLocalnetPort,
} from './data-access/localnet-types.ts'
import { mergeOwnedForwards, readOwnedForwards, writeOwnedForwards } from './data-access/owned-forwards-store.ts'
import { forwardKey } from './data-access/plan-forwards.ts'
import { defaultJsonRpcFetcher, probeRpc, waitForRpc } from './data-access/probe-rpc.ts'
import { createInterruptSignal, waitForAbort, watchForwards } from './data-access/watch-forwards.ts'
import { removeLocalnetForwards } from './localnet-feature-stop.ts'
import {
  attachedMessage,
  DATASOURCE_NOT_APPLIED_ON_ATTACH_MESSAGE,
  DEVICES_HEADING,
  DOCKER_UNAVAILABLE_MESSAGE,
  devicesMessage,
  endpointsMessage,
  PORT_CONFLICT_HINT_MESSAGE,
  unmanagedContainerMessage,
  validatorReadyTitle,
  WAITING_FOR_RPC_MESSAGE,
} from './ui/localnet-ui-messages.ts'
import { renderDevicesHeading, renderForwards } from './ui/localnet-ui-render-forwards.ts'

export interface RunLocalnetStartDependencies extends AdbDependencies {
  cancel?: (message: string) => void
  fetchJsonRpc?: JsonRpcFetcher
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  readOwnedForwards?: typeof readOwnedForwards
  signal?: AbortSignal
  spinner?: typeof spinner
  writeOwnedForwards?: typeof writeOwnedForwards
}

export async function runLocalnetStart(
  options: LocalnetStartCommandOptions = {},
  {
    cancel: showCancel = cancel,
    fetchJsonRpc = defaultJsonRpcFetcher,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    readOwnedForwards: readOwned = readOwnedForwards,
    runCommand = runExecutable,
    signal,
    spinner: createSpinner = spinner,
    writeOwnedForwards: writeOwned = writeOwnedForwards,
  }: RunLocalnetStartDependencies = {},
) {
  // Hoisted so the failure path can undo what this run created. `docker run` can succeed and a later
  // step still throw, which previously left an orphaned container behind.
  let ownsContainer = false
  let cleanupPorts: readonly ResolvedLocalnetPort[] | undefined
  const owned = new Map<string, OwnedForward>()

  try {
    showIntro('solana-mobile localnet')

    // `docker inspect` failing (including Docker being absent) reports "not running", so this is safe to
    // ask before we know whether Docker is needed at all. It has to come first: a running container
    // decides the engine and host ports we are about to reuse, and resolving those from defaults would
    // reuse a test-validator container as though it were surfpool.
    const existing = await inspectLocalnetContainer({ runCommand })
    const localnet = resolveLocalnetForContainer(existing, options, { runningOnly: true })
    const rpcUrl = localnetRpcUrl(localnet)
    // Probe before touching Docker: a validator already serving these ports — a native build, or one
    // started by hand — would make `docker run` fail on the port bind. Attaching also means this path
    // needs no Docker at all.
    const preflight = existing.running ? { ok: false } : await probeRpc(rpcUrl, { fetchJsonRpc })
    const action = planEngineAction({ containerRunning: existing.running, rpcReachable: preflight.ok })

    let rpc = preflight

    cleanupPorts = localnet.ports

    if (action === 'attach') {
      log(attachedMessage(rpcUrl, preflight.version))

      if (localnet.datasource) {
        log(DATASOURCE_NOT_APPLIED_ON_ATTACH_MESSAGE)
      }
    } else {
      if (action === 'start') {
        if (!(await isDockerRunning({ runCommand }))) {
          throw new Error(DOCKER_UNAVAILABLE_MESSAGE)
        }

        if (existing.status) {
          // A stopped container with our name would make `docker run` fail on the name conflict. Only
          // remove one we created: an unlabelled namesake is someone else's, so stop and say so rather
          // than force-removing work we know nothing about.
          if (!isManagedContainer(existing)) {
            throw new Error(unmanagedContainerMessage(existing.name))
          }

          await removeLocalnetContainer({ runCommand })
        }
      }

      // One spinner across both phases, so bring-up reports its progress without printing a completion
      // line that the endpoints note is about to repeat.
      const bringUp = createSpinner()

      bringUp.start(action === 'start' ? `Starting ${localnet.engine.id} (${localnet.image})` : WAITING_FOR_RPC_MESSAGE)

      if (action === 'start') {
        try {
          await startLocalnetContainer(localnet, { runCommand })
          ownsContainer = true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          bringUp.error(message)
          throw new Error(`${message}\n${PORT_CONFLICT_HINT_MESSAGE}`)
        }

        bringUp.message(WAITING_FOR_RPC_MESSAGE)
      }

      rpc = await waitForRpc(rpcUrl, {
        fetchJsonRpc,
        // Fail fast instead of waiting out the timeout when the container has already died.
        onAttempt: async () => {
          const status = await inspectLocalnetContainer({ runCommand })

          if (status.status && !status.running) {
            throw new Error(
              `The localnet container exited (${status.status}). Check: ${formatCommand('localnet logs')}`,
            )
          }
        },
      }).catch((error: unknown) => {
        bringUp.error(error instanceof Error ? error.message : String(error))
        throw error
      })

      if (!rpc.ok) {
        bringUp.error(`Validator did not become ready: ${rpc.error}`)
        throw new Error(`Validator did not become ready: ${rpc.error}`)
      }

      bringUp.stop(action === 'start' ? `Started ${localnet.engine.id}` : `Reusing container ${existing.name}`)
    }

    // Endpoints first — they are what people came for. The forwards table is supporting detail.
    showNote(endpointsMessage(localnetEndpoints(localnet)), validatorReadyTitle(rpc.version))
    // Detached mode applies forwards once and exits: there is no process left to reconcile, so claiming
    // otherwise would promise a watcher that does not exist.
    showNote(
      devicesMessage({ holding: !options.detach, watching: Boolean(options.watch) && !options.detach }),
      DEVICES_HEADING,
    )

    // Teardown removes exactly what this run put in place. A reverse that was already correct when we
    // arrived belongs to whoever created it — deleting it on Ctrl-C would break their setup.
    // Recorded as each reverse lands rather than once `syncForwards` returns: if the second reverse
    // throws, the first is already on the device and still has to be rolled back.
    const recordOwned = (forward: OwnedForward) => {
      owned.set(forwardKey(forward.serial, forward.devicePort), forward)
    }

    const { actions, devices } = await syncForwards(
      { devices: options.devices, ports: localnet.ports },
      { onApplied: recordOwned, runCommand },
    )

    renderForwards(actions, devices)

    if (options.detach) {
      // Nothing survives this process to remember what it claimed, and `stop` is what the outro tells
      // people to run — including in attach mode, where there is no container to record it on. Merged
      // with any existing claim: a repeat run finds the forwards already correct, applies nothing, and
      // would otherwise overwrite the first run's record with an empty one.
      await writeOwned(mergeOwnedForwards((await readOwned()) ?? [], [...owned.values()]))
      showOutro(
        ownsContainer
          ? `Running in the background. Stop it with: ${formatCommand('localnet stop')}`
          : `Port forwards are in place. Remove them with: ${formatCommand('localnet stop')}`,
      )
      return
    }

    const interrupt = signal ?? createInterruptSignal()

    if (options.watch) {
      await watchForwards(
        {
          devices: options.devices,
          onApplied: recordOwned,
          onError: (error) => log(`Retrying after adb error: ${error}`),
          onSync: ({ actions: synced, devices: current }) => {
            renderDevicesHeading()
            renderForwards(synced, current)
          },
          ports: localnet.ports,
          signal: interrupt,
        },
        { runCommand },
      )
    } else {
      await waitForAbort(interrupt)
    }

    // Only tear down what this run created. A validator someone else started — or a container left by an
    // earlier `--detach` — is theirs to stop.
    const stopSpinner = createSpinner()
    stopSpinner.start(ownsContainer ? 'Stopping localnet' : 'Removing port forwards')
    await removeLocalnetForwards(
      { devices: options.devices, owned: [...owned.values()], ports: localnet.ports },
      { runCommand },
    ).catch(() => {})

    if (ownsContainer) {
      await removeLocalnetContainer({ runCommand }).catch(() => {})
    }

    // The record is deliberately left alone: a foreground run never writes one, so clearing it here would
    // throw away an earlier detached session's bookkeeping. `stop` owns clearing it.
    stopSpinner.stop(ownsContainer ? 'Stopped localnet' : 'Removed port forwards')

    showOutro('Done')
  } catch (error) {
    // A container this run created must not outlive the failure. Attached validators and containers left
    // by an earlier session are untouched, exactly as on the success path.
    if (cleanupPorts && owned.size > 0) {
      await removeLocalnetForwards(
        { devices: options.devices, owned: [...owned.values()], ports: cleanupPorts },
        { runCommand },
      ).catch(() => {})
    }

    if (ownsContainer) {
      await removeLocalnetContainer({ runCommand }).catch(() => {})
    }

    showCancel(`${error}`)
    process.exitCode = 1
  }
}
