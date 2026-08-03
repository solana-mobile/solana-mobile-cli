import { join } from 'node:path'
import { runExecutable, runInteractiveExecutable } from '../../core/data-access/run-executable.ts'
import { parseSystemImagePackage, systemImagePackageToRelativeDirectory } from './avd-config.ts'
import { defaultPathExists } from './create-avd.ts'
import type { CommandRunner, DirectoryReader, InteractiveCommandRunner, PathChecker } from './emulator-types.ts'
import { defaultReadDirectory } from './list-installed-avds.ts'
import { sortSystemImagesNewestFirst } from './list-installed-system-images.ts'
import { resolveAndroidCommandLineTool } from './resolve-android-command-line-tool.ts'

const GOOGLE_PLAY_SYSTEM_IMAGES_PATTERN = 'system-images/*/google_apis_playstore*/*'

interface AndroidSdkPackageManager {
  executable: string
  type: 'android' | 'sdkmanager'
}

export interface SystemImagePackageManagerDependencies {
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
  runCommand?: CommandRunner
  runInteractiveCommand?: InteractiveCommandRunner
}

export function filterCompatibleSystemImages(systemImages: readonly string[], architecture: string): string[] {
  const abi = getAbiForArchitecture(architecture)
  const compatibleSystemImages = systemImages.filter((systemImage) => {
    const { abi: systemImageAbi, tagId } = parseSystemImagePackage(systemImage)
    return systemImageAbi === abi && (tagId === 'google_apis_playstore' || tagId === 'google_apis_playstore_ps16k')
  })

  return sortSystemImagesNewestFirst(compatibleSystemImages)
}

export function filterSystemImagesForPlatform(systemImages: readonly string[], androidPlatform: string): string[] {
  return systemImages.filter((systemImage) => {
    const imagePlatform = parseSystemImagePackage(systemImage).platform
    return imagePlatform === androidPlatform || imagePlatform.startsWith(`${androidPlatform}-ext`)
  })
}

export async function installSystemImage(
  systemImage: string,
  sdkRoot: string,
  {
    pathExists = defaultPathExists(),
    readDirectory,
    runInteractiveCommand = runInteractiveExecutable,
  }: SystemImagePackageManagerDependencies = {},
): Promise<void> {
  const packageManager = await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, readDirectory })
  const packageName =
    packageManager.type === 'android' ? systemImagePackageToRelativeDirectory(systemImage) : systemImage
  const args = packageManager.type === 'android' ? ['sdk', 'install', packageName] : ['--install', packageName]

  await runInteractiveCommand([packageManager.executable, ...args])
}

export async function listAvailableSystemImages(
  sdkRoot: string,
  {
    pathExists = defaultPathExists(),
    readDirectory,
    runCommand = runExecutable,
  }: SystemImagePackageManagerDependencies = {},
): Promise<string[]> {
  const packageManager = await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, readDirectory })
  const command: [string, ...string[]] =
    packageManager.type === 'android'
      ? [packageManager.executable, 'sdk', 'list', '--all', GOOGLE_PLAY_SYSTEM_IMAGES_PATTERN]
      : [packageManager.executable, '--list']

  return parseSystemImagePackages(await runCommand(command))
}

export async function listInstalledAndroidPlatforms(
  sdkRoot: string,
  { readDirectory = defaultReadDirectory }: Pick<SystemImagePackageManagerDependencies, 'readDirectory'> = {},
): Promise<string[]> {
  try {
    return (await readDirectory(join(sdkRoot, 'platforms')))
      .filter((entry) => entry.isDirectory() && /^android-\d+(?:\.\d+)*$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
  } catch {
    return []
  }
}

export async function uninstallSystemImages(
  systemImages: readonly string[],
  sdkRoot: string,
  {
    pathExists = defaultPathExists(),
    readDirectory,
    runInteractiveCommand = runInteractiveExecutable,
  }: SystemImagePackageManagerDependencies = {},
): Promise<void> {
  const packageManager = await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, readDirectory })
  const packageNames =
    packageManager.type === 'android'
      ? systemImages.map((systemImage) => systemImagePackageToRelativeDirectory(systemImage))
      : systemImages
  const args = packageManager.type === 'android' ? ['sdk', 'remove', ...packageNames] : ['--uninstall', ...packageNames]

  await runInteractiveCommand([packageManager.executable, ...args])
}

export function normalizeSystemImagePackage(systemImage: string): string {
  const segments = systemImage.trim().split(/[;/]/)

  if (segments.length !== 4) {
    throw new Error(`Invalid system image package: ${systemImage}`)
  }

  const normalized = segments.join(';')
  parseSystemImagePackage(normalized)
  return normalized
}

export function parseSystemImagePackages(output: string): string[] {
  const matches = output.matchAll(/^\s*(system-images(?:[;/][^\s|]+){3})(?:\s|\||$)/gm)
  const systemImages = [...matches].map((match) => normalizeSystemImagePackage(match[1] as string))

  return [...new Set(systemImages)].sort((left, right) => left.localeCompare(right))
}

function getAbiForArchitecture(architecture: string): string {
  if (architecture === 'arm64') {
    return 'arm64-v8a'
  }

  if (architecture === 'x64') {
    return 'x86_64'
  }

  throw new Error(`Unsupported host architecture: ${architecture}`)
}

async function resolveAndroidSdkPackageManager(
  sdkRoot: string,
  dependencies: { pathExists: PathChecker; readDirectory?: DirectoryReader },
): Promise<AndroidSdkPackageManager> {
  try {
    return {
      executable: await resolveAndroidCommandLineTool(sdkRoot, 'android', dependencies),
      type: 'android',
    }
  } catch {
    try {
      return {
        executable: await resolveAndroidCommandLineTool(sdkRoot, 'sdkmanager', dependencies),
        type: 'sdkmanager',
      }
    } catch {
      throw new Error(
        `Android SDK package manager not found under ${join(sdkRoot, 'cmdline-tools')}. Install Android SDK Command-line Tools.`,
      )
    }
  }
}
