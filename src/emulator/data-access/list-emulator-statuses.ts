import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { CommandRunner, EmulatorStatus, ListEmulatorStatusesDependencies } from './emulator-types.ts'
import { listInstalledAvds } from './list-installed-avds.ts'
import { parseAdbEmulatorDevices, parseRunningEmulatorName } from './list-running-emulators.ts'

export async function listEmulatorStatuses({
  getHomeDirectory,
  readDirectory,
  readTextFile,
  runCommand = runExecutable,
}: ListEmulatorStatusesDependencies = {}): Promise<EmulatorStatus[]> {
  const installedAvds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })
  const adbDevices = parseAdbEmulatorDevices(await runCommand(['adb', 'devices']))
  const adbStatuses = await Promise.all(
    adbDevices.map(async ({ serial, state }) => {
      const name = state === 'device' ? await resolveAdbEmulatorName(serial, runCommand) : undefined

      return {
        booted: await resolveBootCompleted(serial, state, runCommand),
        name,
        serial,
        state: renderAdbState(state),
      }
    }),
  )
  const statuses: EmulatorStatus[] = installedAvds.map(({ device, name, target }) => {
    const adbStatus = adbStatuses.find((status) => status.name === name)

    return {
      booted: adbStatus?.booted ?? 'no',
      device,
      name,
      serial: adbStatus?.serial,
      state: adbStatus?.state ?? 'offline',
      target,
    }
  })
  const installedNames = new Set(installedAvds.map(({ name }) => name))

  for (const adbStatus of adbStatuses) {
    if (adbStatus.name && installedNames.has(adbStatus.name)) {
      continue
    }

    statuses.push({
      booted: adbStatus.booted,
      name: adbStatus.name ?? '',
      serial: adbStatus.serial,
      state: adbStatus.state,
    })
  }

  return statuses.sort(
    (left, right) => left.name.localeCompare(right.name) || (left.serial ?? '').localeCompare(right.serial ?? ''),
  )
}

async function resolveAdbEmulatorName(serial: string, runCommand: CommandRunner): Promise<string | undefined> {
  try {
    return parseRunningEmulatorName(await runCommand(['adb', '-s', serial, 'emu', 'avd', 'name']))
  } catch {
    return undefined
  }
}

async function resolveBootCompleted(
  serial: string,
  state: string,
  runCommand: CommandRunner,
): Promise<EmulatorStatus['booted']> {
  if (state !== 'device') {
    return 'unknown'
  }

  try {
    return (await runCommand(['adb', '-s', serial, 'shell', 'getprop', 'sys.boot_completed'])).trim() === '1'
      ? 'yes'
      : 'no'
  } catch {
    return 'unknown'
  }
}

function renderAdbState(state: string): string {
  return state === 'device' ? 'online' : state
}
