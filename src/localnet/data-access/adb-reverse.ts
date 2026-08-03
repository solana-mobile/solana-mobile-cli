import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { AdbDependencies, AdbReverseEntry } from './localnet-types.ts'

export async function listAdbReverses(
  serial: string,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<AdbReverseEntry[]> {
  return parseAdbReverses(await runCommand(['adb', '-s', serial, 'reverse', '--list']))
}

/**
 * `adb reverse --list` prints `<transport> <devicePort> <hostPort>`, verified against a live device:
 * `adb reverse tcp:8899 tcp:9899` lists as `host-14 tcp:8899 tcp:9899`.
 */
export function parseAdbReverses(contents: string): AdbReverseEntry[] {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [, device, host] = line.split(/\s+/)
      const devicePort = parseTcpPort(device)
      const hostPort = parseTcpPort(host)

      if (devicePort === undefined || hostPort === undefined) {
        return []
      }

      return [{ devicePort, hostPort }]
    })
    .sort((left, right) => left.devicePort - right.devicePort)
}

export function parseTcpPort(value: string | undefined): number | undefined {
  if (!value?.startsWith('tcp:')) {
    return undefined
  }

  const port = Number(value.slice(4))

  return Number.isInteger(port) && port > 0 ? port : undefined
}

export async function createAdbReverse(
  serial: string,
  { devicePort, hostPort }: AdbReverseEntry,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  await runCommand(['adb', '-s', serial, 'reverse', `tcp:${devicePort}`, `tcp:${hostPort}`])
}

/**
 * Removes a single reverse by its device port. We never use `adb reverse --remove-all`: developers
 * commonly have unrelated reverses (Metro on 8081) that must survive.
 */
export async function removeAdbReverse(
  serial: string,
  devicePort: number,
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<void> {
  await runCommand(['adb', '-s', serial, 'reverse', '--remove', `tcp:${devicePort}`])
}
