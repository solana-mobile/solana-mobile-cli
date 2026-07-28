import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { formatCliCommand } from '../../core/util/format-cli-command.ts'
import type { InstalledAvd } from '../../emulator/data-access/emulator-types.ts'
import { listInstalledAvds } from '../../emulator/data-access/list-installed-avds.ts'
import type { DoctorCheckResult } from './doctor-check-result.ts'
import { type DoctorEnvironment, findExecutable } from './doctor-environment.ts'

export type AdbDevice = {
  attributes: Record<string, string>
  kind: 'emulator' | 'physical'
  serial: string
  state: string
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .flatMap((line) => {
      const [serial, state, ...parts] = line.split(/\s+/)
      if (!serial || !state) return []
      const attributes = Object.fromEntries(
        parts.flatMap((part) => {
          const index = part.indexOf(':')
          return index > 0 ? [[part.slice(0, index), part.slice(index + 1)]] : []
        }),
      )
      return [
        {
          attributes,
          kind: serial.startsWith('emulator-') ? ('emulator' as const) : ('physical' as const),
          serial,
          state,
        },
      ]
    })
    .sort((left, right) => left.serial.localeCompare(right.serial))
}

export async function checkAndroidDevices(
  environment: DoctorEnvironment,
  adbAvailable: boolean,
  sdkRoot?: string,
  installedAvds?: InstalledAvd[],
): Promise<DoctorCheckResult[]> {
  const resolvedInstalledAvds = installedAvds ?? (await listInstalledAvds())
  const avdNames = resolvedInstalledAvds.map(({ name }) => name)
  const avdCheck: DoctorCheckResult = {
    actual: avdNames.length ? `${avdNames.length} installed (${avdNames.join(', ')})` : 'none installed',
    category: 'emulator',
    message: avdNames.length
      ? `Detected ${avdNames.length} installed Android emulator(s).`
      : 'No Android emulators are installed.',
    name: 'Android emulators',
    recommendation: avdNames.length
      ? undefined
      : `Create one with: ${formatCliCommand('emulator create', environment.environment)}`,
    status: avdNames.length ? 'pass' : 'warn',
  }
  if (!adbAvailable)
    return [
      avdCheck,
      {
        actual: 'unknown',
        category: 'emulator',
        message: 'Running emulators cannot be checked without adb.',
        name: 'Running emulators',
        status: 'info',
      },
      {
        actual: 'unknown',
        category: 'device',
        message: 'Physical devices cannot be checked without adb.',
        name: 'Physical devices',
        status: 'info',
      },
    ]
  const adbExecutable = await findExecutable('adb', environment, sdkRoot ? [join(sdkRoot, 'platform-tools')] : [])
  if (!adbExecutable)
    return [
      avdCheck,
      {
        actual: 'unknown',
        category: 'emulator',
        message: 'Running emulators cannot be checked without adb.',
        name: 'Running emulators',
        status: 'info',
      },
      {
        actual: 'unknown',
        category: 'device',
        message: 'Physical devices cannot be checked without adb.',
        name: 'Physical devices',
        status: 'info',
      },
    ]
  let devices: AdbDevice[] = []
  try {
    const result = await environment.runCommand(adbExecutable, ['devices', '-l'])
    devices = parseAdbDevices(result.stdout)
  } catch {
    /* reported by adb check */
  }
  const emulators = devices.filter(({ kind }) => kind === 'emulator')
  const physical = devices.filter(({ kind }) => kind === 'physical')
  const running: DoctorCheckResult = {
    actual: emulators.length ? emulators.map(({ serial, state }) => `${serial} (${state})`).join(', ') : 'none',
    category: 'emulator',
    details: emulators.map(({ serial }) => `Serial: ${serial}`),
    message: emulators.length ? 'Detected running emulator instances.' : 'No emulator is currently running.',
    name: 'Running emulators',
    status: 'info',
  }
  const authorized = physical.filter(({ state }) => state === 'device')
  const problematic = physical.filter(({ state }) => state !== 'device')
  const recommendation = problematic.some(({ state }) => state === 'unauthorized')
    ? 'Unlock the phone and accept the USB debugging authorization dialog.'
    : problematic.length
      ? 'Reconnect the offline Android device and restart adb if necessary.'
      : undefined
  const physicalCheck: DoctorCheckResult = {
    actual: physical.length ? physical.map(formatPhysicalDevice).join(', ') : 'none connected',
    category: 'device',
    details: physical.map(({ serial }) => `Serial: ${serial}`),
    message: authorized.length
      ? `Detected ${authorized.length} authorized physical device(s).`
      : problematic.length
        ? 'A physical device is connected but unavailable.'
        : 'No physical Android device is connected.',
    name: 'Physical devices',
    recommendation,
    status: authorized.length ? 'pass' : problematic.length ? 'warn' : 'info',
  }
  return [avdCheck, running, physicalCheck]
}

export async function checkEmulatorAcceleration(environment: DoctorEnvironment): Promise<DoctorCheckResult> {
  const platform = environment.getPlatform()
  if (platform === 'darwin')
    return {
      actual: 'Hypervisor Framework available on supported Macs',
      category: 'emulator',
      message: 'macOS Android Emulator uses Hypervisor Framework when supported.',
      name: 'Emulator acceleration',
      status: 'info',
    }
  if (platform === 'linux') {
    const available = await access('/dev/kvm').then(
      () => true,
      () => false,
    )
    return {
      actual: available ? '/dev/kvm available' : '/dev/kvm unavailable',
      category: 'emulator',
      message: available ? 'KVM acceleration is available.' : 'KVM acceleration is unavailable or inaccessible.',
      name: 'Emulator acceleration',
      recommendation: available ? undefined : 'Enable KVM and grant the current user access to /dev/kvm.',
      status: available ? 'pass' : 'warn',
    }
  }
  return {
    actual: 'unknown',
    category: 'emulator',
    message: 'Emulator acceleration could not be determined reliably.',
    name: 'Emulator acceleration',
    status: 'info',
  }
}

function formatPhysicalDevice(device: AdbDevice) {
  const label = device.attributes.model?.replaceAll('_', ' ') ?? device.serial
  const state = device.state === 'device' ? 'authorized' : device.state
  return `${label} (${state})`
}
