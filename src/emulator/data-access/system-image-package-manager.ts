import { join } from 'node:path'
import type { CommandRunner, InteractiveRunCommandOptions } from '../../core/data-access/command-types.ts'
import { runInteractiveExecutable } from '../../core/data-access/run-executable.ts'
import { parseSystemImagePackage, systemImagePackageToRelativeDirectory } from './avd-config.ts'
import { defaultPathExists } from './create-avd.ts'
import type { DirectoryReader, PathChecker } from './emulator-types.ts'
import { defaultReadDirectory } from './list-installed-avds.ts'
import { isSystemImageInstalled, sortSystemImagesNewestFirst } from './list-installed-system-images.ts'
import { resolveAndroidCommandLineTool } from './resolve-android-command-line-tool.ts'

export interface AndroidSdkPackageManager {
  executable: string
  type: 'android' | 'sdkmanager'
}

/** Fits both a captured and an interactive runner: an install is judged by what lands on disk, output only feeds the error. */
type SystemImageCommandRunner = (cmd: [string, ...string[]], options?: InteractiveRunCommandOptions) => Promise<unknown>

export interface SystemImagePackageManagerDependencies {
  pathExists?: PathChecker
  platform?: NodeJS.Platform
  readDirectory?: DirectoryReader
  runCommand?: CommandRunner
  runInteractiveCommand?: SystemImageCommandRunner
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
    platform,
    readDirectory,
    runInteractiveCommand = runInteractiveExecutable,
  }: SystemImagePackageManagerDependencies = {},
): Promise<void> {
  const packageManager = await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, platform, readDirectory })
  const packageName =
    packageManager.type === 'android' ? systemImagePackageToRelativeDirectory(systemImage) : systemImage
  const args = packageManager.type === 'android' ? ['sdk', 'install', packageName] : ['--install', packageName]

  let failure: unknown
  let output: unknown

  // The exit code cannot judge the install: on Windows the installer aborts on exit (STATUS_STACK_BUFFER_OVERRUN)
  // after a complete install, and sdkmanager exits 0 after failing to find a package. The package on disk can.
  // See solana-mobile/solana-mobile-cli#51.
  try {
    output = await runInteractiveCommand([packageManager.executable, ...args])
  } catch (error) {
    failure = error
  }

  if (await isSystemImageInstalled(sdkRoot, systemImage, pathExists)) {
    return
  }

  if (failure) {
    throw failure
  }

  throw new Error(
    [`System image was not installed: ${systemImage}`, typeof output === 'string' ? output.trim() : '']
      .filter(Boolean)
      .join('\n'),
  )
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
    platform,
    readDirectory,
    runInteractiveCommand = runInteractiveExecutable,
  }: SystemImagePackageManagerDependencies = {},
): Promise<void> {
  const packageManager = await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, platform, readDirectory })
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

/** The tool that installs and removes SDK packages: the Android CLI, or `sdkmanager` on older Command-line Tools. */
export async function resolveAndroidSdkPackageManager(
  sdkRoot: string,
  {
    pathExists = defaultPathExists(),
    platform,
    readDirectory,
  }: Pick<SystemImagePackageManagerDependencies, 'pathExists' | 'platform' | 'readDirectory'> = {},
): Promise<AndroidSdkPackageManager> {
  const dependencies = { pathExists, platform, readDirectory }

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

function getAbiForArchitecture(architecture: string): string {
  if (architecture === 'arm64') {
    return 'arm64-v8a'
  }

  if (architecture === 'x64') {
    return 'x86_64'
  }

  throw new Error(`Unsupported host architecture: ${architecture}`)
}
