import { join } from 'node:path'
import { resolveAndroidSdkRoot } from '../../core/data-access/android-sdk-root.ts'
import type { EmulatorCreateCommandOptions, ParsedSystemImagePackage, ResolvedCreateOptions } from './emulator-types.ts'

export const DEFAULT_PROFILE_NAME = 'solana-mobile'

export const DEFAULT_PROFILE = {
  dataSize: '32G',
  device: 'pixel_9_pro_xl',
  name: 'solana-mobile',
  ramMb: 8192,
  sdcardSize: '512M',
  vmHeapMb: 576,
} as const

export function createAvdConfigValues(options: ResolvedCreateOptions): Record<string, string> {
  const { abi, platform, tagId } = parseSystemImagePackage(options.systemImage)

  return {
    'abi.type': abi,
    'avd.ini.displayname': options.name.replaceAll('_', ' '),
    'disk.dataPartition.size': options.dataSize,
    'fastboot.forceChosenSnapshotBoot': 'no',
    'fastboot.forceColdBoot': 'no',
    'fastboot.forceFastBoot': 'yes',
    'hw.audioInput': 'yes',
    'hw.camera.back': 'virtualscene',
    'hw.camera.front': 'emulated',
    'hw.cpu.arch': getCpuArchitecture(abi),
    'hw.cpu.ncore': '4',
    'hw.device.name': options.device,
    'hw.gpu.enabled': 'yes',
    'hw.gpu.mode': 'auto',
    'hw.keyboard': 'yes',
    'hw.ramSize': String(options.ramMb),
    'hw.sdCard': 'yes',
    'image.sysdir.1': `${systemImagePackageToRelativeDirectory(options.systemImage)}/`,
    'PlayStore.enabled': String(tagId.includes('play')),
    'runtime.network.latency': 'none',
    'runtime.network.speed': 'full',
    'sdcard.size': options.sdcardSize,
    showDeviceFrame: 'yes',
    'skin.dynamic': 'yes',
    'tag.display': getTagDisplay(tagId),
    'tag.id': tagId,
    target: platform,
    'userdata.useQcow2': 'no',
    'vm.heapSize': String(options.vmHeapMb),
  }
}

export function getEmulatorExecutablePath(sdkRoot: string, platform: NodeJS.Platform = process.platform): string {
  return join(sdkRoot, 'emulator', platform === 'win32' ? 'emulator.exe' : 'emulator')
}

export function parseAvdConfig(contents: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const separatorIndex = line.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)

    if (key) {
      values[key] = value
    }
  }

  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)))
}

export function parseSystemImagePackage(systemImage: string): ParsedSystemImagePackage {
  const [category, platform, tagId, abi] = systemImage.split(';')

  if (category !== 'system-images' || !platform || !tagId || !abi) {
    throw new Error(`Invalid system image package: ${systemImage}`)
  }

  return {
    abi,
    platform,
    tagId,
  }
}

export function resolveCreateOptions(
  options: EmulatorCreateCommandOptions,
  systemImage: string,
): ResolvedCreateOptions {
  const profile = resolveEmulatorProfile(options.profile)

  return {
    dataSize: options.dataSize ?? profile.dataSize,
    device: options.device ?? profile.device,
    name: options.name ?? profile.name,
    ramMb: options.ramMb ?? profile.ramMb,
    sdcardSize: options.sdcardSize ?? profile.sdcardSize,
    sdkRoot: options.sdkRoot ?? resolveAndroidSdkRoot(),
    systemImage,
    vmHeapMb: options.vmHeapMb ?? profile.vmHeapMb,
  }
}

export function resolveEmulatorProfile(profileName = DEFAULT_PROFILE_NAME): typeof DEFAULT_PROFILE {
  if (profileName === DEFAULT_PROFILE_NAME) {
    return DEFAULT_PROFILE
  }

  throw new Error(`Unknown emulator profile: ${profileName}`)
}

export function serializeAvdConfig(values: Record<string, string>): string {
  return `${Object.keys(values)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${values[key]}`)
    .join('\n')}\n`
}

export function systemImagePackageToRelativeDirectory(systemImage: string): string {
  return systemImage.split(';').join('/')
}

function getCpuArchitecture(abi: string): string {
  if (abi.startsWith('arm64')) {
    return 'arm64'
  }

  if (abi.startsWith('armeabi')) {
    return 'arm'
  }

  return abi.split('-', 1)[0] ?? abi
}

function getTagDisplay(tagId: string): string {
  if (tagId === 'google_apis') {
    return 'Google APIs'
  }

  if (tagId === 'google_apis_playstore' || tagId === 'google_apis_playstore_ps16k') {
    return 'Google Play'
  }

  return tagId
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase()}${segment.slice(1).toLowerCase()}`)
    .join(' ')
}
