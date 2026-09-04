import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies } from '../../device/data-access/device-types.ts'
import { type SyncForwardsResult, syncForwards } from './apply-forwards.ts'
import type { OwnedForward, ResolvedLocalnetPort } from './localnet-types.ts'

export interface WatchForwardsOptions {
  devices?: readonly string[]
  intervalMs?: number
  /** Fires as each reverse lands, so a caller can track ownership even if a later one throws. */
  onApplied?: (forward: OwnedForward) => void
  onError?: (error: unknown) => void
  onSync?: (result: SyncForwardsResult) => void
  ports: readonly ResolvedLocalnetPort[]
  signal?: AbortSignal
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * Re-applies forwards until aborted.
 *
 * Reverses are ephemeral: they are dropped when an emulator reboots, when `adb kill-server` runs, and
 * when a device is unplugged. Without this the app just starts failing with an opaque network error and
 * nothing indicates the tunnel is gone. Polling `adb devices` is deliberate — the `track-devices` host
 * service is not exposed consistently across adb CLI versions.
 */
export async function watchForwards(
  { devices, intervalMs = 2_000, onApplied, onError, onSync, ports, signal, wait = waitFor }: WatchForwardsOptions,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  while (!signal?.aborted) {
    await wait(intervalMs, signal)

    if (signal?.aborted) {
      return
    }

    try {
      const result = await syncForwards({ devices, ports }, { onApplied, runCommand })

      if (result.applied.length > 0) {
        onSync?.(result)
      }
    } catch (error) {
      // A transient adb failure (device mid-reboot) must not kill the watch loop.
      onError?.(error)
    }
  }
}

export function createInterruptSignal(): AbortSignal {
  const controller = new AbortController()

  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  return controller.signal
}

/**
 * Holds a foreground command open until Ctrl-C, so teardown can run before the process exits.
 *
 * Neither a signal listener nor an abort listener keeps the Node event loop alive — without the timer
 * the process exits the moment it starts waiting, skipping teardown and leaking the container and its
 * forwards. The watch loop does not hit this because its own timers hold the loop open.
 */
export function waitForAbort(
  signal: AbortSignal,
  { keepAliveMs = 60_000 }: { keepAliveMs?: number } = {},
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const keepAlive = setInterval(() => {}, keepAliveMs)

    signal.addEventListener(
      'abort',
      () => {
        clearInterval(keepAlive)
        resolve()
      },
      { once: true },
    )
  })
}

export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }

    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)

    signal?.addEventListener('abort', finish, { once: true })
  })
}
