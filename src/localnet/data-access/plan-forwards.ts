import type { AdbDevice, AdbReverseEntry } from '../../device/data-access/device-types.ts'
import { isUsableDevice } from '../../device/data-access/list-adb-devices.ts'
import type { ForwardAction, OwnedForward, ResolvedLocalnetPort } from './localnet-types.ts'

export interface PlanForwardsInput {
  devices: readonly AdbDevice[]
  /** Existing reverses per device serial, as reported by `adb reverse --list`. */
  existing: ReadonlyMap<string, readonly AdbReverseEntry[]>
  ports: readonly ResolvedLocalnetPort[]
}

/**
 * Pure planner: decides what each device needs so `--watch` can re-apply forwards without any live adb.
 * Reverses are ephemeral — they vanish on reboot, `adb kill-server`, and re-plug — so this runs on every
 * watch tick and only acts on what is actually missing or wrong.
 */
export function planForwards({ devices, existing, ports }: PlanForwardsInput): ForwardAction[] {
  return devices
    .filter(isUsableDevice)
    .flatMap(({ serial }) =>
      ports.map(({ canonical, host, name }) => {
        const match = existing.get(serial)?.find((entry) => entry.devicePort === canonical)

        return {
          devicePort: canonical,
          hostPort: host,
          kind: match ? (match.hostPort === host ? ('keep' as const) : ('replace' as const)) : ('create' as const),
          name,
          serial,
        }
      }),
    )
    .sort((left, right) => left.serial.localeCompare(right.serial) || left.devicePort - right.devicePort)
}

export function pendingForwards(actions: readonly ForwardAction[]): ForwardAction[] {
  return actions.filter(({ kind }) => kind !== 'keep')
}

/**
 * Selects the reverses to remove: only device ports this engine owns. Anything else the developer set up
 * stays untouched.
 *
 * `owned` narrows that further to the reverses a session actually created or replaced, so tearing down a
 * foreground run leaves a pre-existing reverse on a canonical port — one the plan classified as `keep` —
 * exactly as it found it. A standalone `localnet stop` has no session to consult and falls back to the
 * port set, which is the widest thing it can safely claim.
 */
export function planRemovals({
  existing,
  owned,
  ports,
}: {
  existing: ReadonlyMap<string, readonly AdbReverseEntry[]>
  owned?: readonly OwnedForward[]
  ports: readonly ResolvedLocalnetPort[]
}): OwnedForward[] {
  const canonical = new Set(ports.map((port) => port.canonical))
  const claimed = owned && new Set(owned.map(({ devicePort, serial }) => forwardKey(serial, devicePort)))

  return [...existing.entries()]
    .flatMap(([serial, entries]) =>
      entries
        .filter(
          ({ devicePort }) =>
            canonical.has(devicePort) && (claimed === undefined || claimed.has(forwardKey(serial, devicePort))),
        )
        .map(({ devicePort }) => ({ devicePort, serial })),
    )
    .sort((left, right) => left.serial.localeCompare(right.serial) || left.devicePort - right.devicePort)
}

export function forwardKey(serial: string, devicePort: number): string {
  return `${serial}:${devicePort}`
}

/** The reverses a plan is responsible for: everything it had to create or replace. */
export function ownedForwards(actions: readonly ForwardAction[]): OwnedForward[] {
  return pendingForwards(actions).map(({ devicePort, serial }) => ({ devicePort, serial }))
}

export type ReverseMatch =
  | { kind: 'match' }
  | { kind: 'missing' }
  /** A reverse exists on the canonical port but carries traffic somewhere other than our host port. */
  | { hostPort: number; kind: 'mismatch' }

/**
 * Compares what `adb reverse --list` reports against one expected mapping.
 *
 * The device probe cannot do this: `adbd` accepts on the device-side listener before the host leg is
 * attempted, so a reverse pointing at the wrong — or a dead — host port still connects. Without this the
 * host leg can pass at the expected URL while the app on the device is routed somewhere else entirely.
 */
export function matchReverse(
  entries: readonly AdbReverseEntry[] | undefined,
  { canonical, host }: Pick<ResolvedLocalnetPort, 'canonical' | 'host'>,
): ReverseMatch {
  const entry = entries?.find((candidate) => candidate.devicePort === canonical)

  if (!entry) {
    return { kind: 'missing' }
  }

  return entry.hostPort === host ? { kind: 'match' } : { hostPort: entry.hostPort, kind: 'mismatch' }
}
