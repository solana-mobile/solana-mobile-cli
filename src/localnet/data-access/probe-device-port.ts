import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies, DevicePortProbeResult, ResolvedLocalnetPort } from './localnet-types.ts'

/**
 * Device-side leg of the check.
 *
 * Android ships no HTTP client: there is no `curl` or `wget`, and toybox has no wget applet. `nc` exists
 * but does not forward stdin on current emulator images (verified against Android 17 — the host receives
 * a connection carrying zero bytes), so it cannot perform a JSON-RPC call.
 *
 * What this proves, precisely: exit 0 means a reverse is registered on that device port, exit 1 means
 * `Connection refused`, i.e. no reverse. It does NOT prove the host end is alive — `adbd` accepts on the
 * device-side listener before the host leg is attempted, so a reverse pointing at a dead host port still
 * connects (verified: probes passed with no validator running). Liveness is the host leg's job, which is
 * why the check needs both.
 *
 * The exit code is echoed rather than inferred from adb's own status, and stdout/stderr are discarded, so
 * the command always succeeds and the result is unambiguous.
 */
export async function probeDevicePort(
  serial: string,
  { canonical, name }: ResolvedLocalnetPort,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<DevicePortProbeResult> {
  try {
    const output = await runCommand([
      'adb',
      '-s',
      serial,
      'shell',
      `nc -w 3 127.0.0.1 ${canonical} </dev/null >/dev/null 2>&1; echo $?`,
    ])
    const exitCode = parseProbeExitCode(output)

    if (exitCode === 0) {
      return { devicePort: canonical, name, ok: true }
    }

    return {
      devicePort: canonical,
      name,
      ok: false,
      reason: exitCode === undefined ? `Unexpected probe output: ${output.trim()}` : 'Connection refused on device',
    }
  } catch (error) {
    return {
      devicePort: canonical,
      name,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseProbeExitCode(output: string): number | undefined {
  const last = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)

  if (last === undefined || !/^\d+$/.test(last)) {
    return undefined
  }

  return Number(last)
}

/**
 * Best-effort visual proof: opens a URL in the device browser. Not a programmatic check — on a fresh
 * emulator the browser's first-run screen intercepts the intent.
 */
export async function openUrlOnDevice(
  serial: string,
  url: string,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  await runCommand(['adb', '-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])
}
