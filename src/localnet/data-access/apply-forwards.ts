import { runExecutable } from '../../core/data-access/run-executable.ts'
import { createAdbReverse, listAdbReverses, removeAdbReverse } from '../../device/data-access/adb-reverse.ts'
import type { AdbDependencies, AdbDevice, AdbReverseEntry } from '../../device/data-access/device-types.ts'
import { isUsableDevice, listAdbDevices } from '../../device/data-access/list-adb-devices.ts'
import type { ForwardAction, OwnedForward, ResolvedLocalnetPort } from './localnet-types.ts'
import { pendingForwards, planForwards } from './plan-forwards.ts'

export async function collectExistingReverses(
  devices: readonly AdbDevice[],
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<Map<string, AdbReverseEntry[]>> {
  const entries = await Promise.all(
    devices.filter(isUsableDevice).map(async ({ serial }): Promise<[string, AdbReverseEntry[]]> => {
      try {
        return [serial, await listAdbReverses(serial, { runCommand })]
      } catch {
        // A device can disappear between listing and querying; treat it as having no reverses.
        return [serial, []]
      }
    }),
  )

  return new Map(entries)
}

/**
 * `onApplied` fires as each reverse lands, rather than once at the end.
 *
 * Ownership has to be observable mid-flight: if the second reverse throws, the first one is already on
 * the device and the caller still has to be able to roll it back. Returning ownership only on success
 * would leak it.
 */
export async function applyForwardActions(
  actions: readonly ForwardAction[],
  { onApplied, runCommand = runExecutable }: AdbDependencies & { onApplied?: (forward: OwnedForward) => void } = {},
): Promise<void> {
  for (const { devicePort, hostPort, kind, serial } of pendingForwards(actions)) {
    if (kind === 'replace') {
      await removeAdbReverse(serial, devicePort, { runCommand })
      // Claimed before the replacement lands: the original mapping is already gone, so this run owns the
      // port either way.
      onApplied?.({ devicePort, serial })
    }

    await createAdbReverse(serial, { devicePort, hostPort }, { runCommand })
    onApplied?.({ devicePort, serial })
  }
}

export interface SyncForwardsResult {
  actions: ForwardAction[]
  applied: ForwardAction[]
  devices: AdbDevice[]
}

/**
 * One reconciliation pass: read the world, work out what is missing, fix only that. Safe to call
 * repeatedly, which is what makes `--watch` a loop around this function.
 */
export async function syncForwards(
  { devices: only, ports }: { devices?: readonly string[]; ports: readonly ResolvedLocalnetPort[] },
  { onApplied, runCommand = runExecutable }: AdbDependencies & { onApplied?: (forward: OwnedForward) => void } = {},
): Promise<SyncForwardsResult> {
  const all = await listAdbDevices({ runCommand })
  const devices = only?.length ? all.filter(({ serial }) => only.includes(serial)) : all
  const existing = await collectExistingReverses(devices, { runCommand })
  const actions = planForwards({ devices, existing, ports })

  await applyForwardActions(actions, { onApplied, runCommand })

  return { actions, applied: pendingForwards(actions), devices }
}
