import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { removeAdbReverse } from '../device/data-access/adb-reverse.ts'
import type { AdbDependencies } from '../device/data-access/device-types.ts'
import { listAdbDevices } from '../device/data-access/list-adb-devices.ts'
import { collectExistingReverses } from './data-access/apply-forwards.ts'
import { inspectLocalnetContainer, isManagedContainer, removeLocalnetContainer } from './data-access/docker-engine.ts'
import { resolveLocalnetForContainer } from './data-access/localnet-engines.ts'
import type { LocalnetStopCommandOptions, OwnedForward, ResolvedLocalnetPort } from './data-access/localnet-types.ts'
import { clearOwnedForwards, readOwnedForwards } from './data-access/owned-forwards-store.ts'
import { planRemovals } from './data-access/plan-forwards.ts'
import { unmanagedContainerMessage } from './ui/localnet-ui-messages.ts'

export interface RunLocalnetStopDependencies extends AdbDependencies {
  cancel?: (message: string) => void
  clearOwnedForwards?: typeof clearOwnedForwards
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  readOwnedForwards?: typeof readOwnedForwards
}

/**
 * Removes only the reverses this engine owns. Developers routinely have unrelated reverses set up —
 * Metro listens on 8081 — and `adb reverse --remove-all` would silently break them.
 *
 * `owned` narrows this to what a session created, so a foreground run tears down its own work and
 * nothing else. See `planRemovals`.
 */
export async function removeLocalnetForwards(
  {
    devices: only,
    owned,
    ports,
  }: { devices?: readonly string[]; owned?: readonly OwnedForward[]; ports: readonly ResolvedLocalnetPort[] },
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<OwnedForward[]> {
  const all = await listAdbDevices({ runCommand })
  const devices = only?.length ? all.filter(({ serial }) => only.includes(serial)) : all
  const removals = planRemovals({ existing: await collectExistingReverses(devices, { runCommand }), owned, ports })

  for (const { devicePort, serial } of removals) {
    await removeAdbReverse(serial, devicePort, { runCommand })
  }

  return removals
}

export async function runLocalnetStop(
  options: LocalnetStopCommandOptions = {},
  {
    cancel: showCancel = cancel,
    clearOwnedForwards: clearOwned = clearOwnedForwards,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    readOwnedForwards: readOwned = readOwnedForwards,
    runCommand = runExecutable,
  }: RunLocalnetStopDependencies = {},
) {
  try {
    showIntro('solana-mobile localnet stop')

    const container = await inspectLocalnetContainer({ runCommand })
    const localnet = resolveLocalnetForContainer(container, options)
    // A detached session records what it claimed, so `stop` tears down exactly those reverses. The record
    // lives outside Docker because `--detach` can attach to a validator with no container of ours at all.
    // No record means ownership is unknown, and we fall back to the canonical port set.
    const removed = await removeLocalnetForwards(
      { devices: options.devices, owned: await readOwned(), ports: localnet.ports },
      { runCommand },
    )

    await clearOwned().catch(() => {})

    log(removed.length ? `Removed ${removed.length} port forward(s).` : 'No port forwards to remove.')

    if (!container.status) {
      log('No localnet container is running.')
    } else if (isManagedContainer(container)) {
      await removeLocalnetContainer({ runCommand })
      log(`Removed container ${container.name}.`)
    } else {
      // Someone else's container happens to hold the name. Force-removing it would destroy work we know
      // nothing about, so say what we found and let them decide.
      log(unmanagedContainerMessage(container.name))
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
