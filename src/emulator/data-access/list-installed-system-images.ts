import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { isDefaultAndroidApiLevel, parseSystemImagePackage } from './avd-config.ts'
import type { DirectoryReader, PathChecker } from './emulator-types.ts'
import { defaultReadDirectory } from './list-installed-avds.ts'

export const NO_INSTALLED_SYSTEM_IMAGES_MESSAGE = [
  'No Android system images are installed.',
  'Install an Android system image with:',
  '  solana-mobile emulator images install',
].join('\n')

interface ListInstalledSystemImagesDependencies {
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
}

export async function listInstalledSystemImages(
  sdkRoot: string,
  { pathExists = defaultPathExists, readDirectory = defaultReadDirectory }: ListInstalledSystemImagesDependencies = {},
): Promise<string[]> {
  const systemImagesRoot = join(sdkRoot, 'system-images')
  const platforms = await listDirectoryNames(systemImagesRoot, readDirectory)
  const systemImages: string[] = []

  for (const platform of platforms) {
    const tags = await listDirectoryNames(join(systemImagesRoot, platform), readDirectory)

    for (const tag of tags) {
      const architectures = await listDirectoryNames(join(systemImagesRoot, platform, tag), readDirectory)

      for (const architecture of architectures) {
        const systemImage = `system-images;${platform};${tag};${architecture}`

        if (await isSystemImageInstalled(sdkRoot, systemImage, pathExists)) {
          systemImages.push(systemImage)
        }
      }
    }
  }

  return systemImages.sort((left, right) => left.localeCompare(right))
}

/**
 * A system image counts as installed once its `source.properties` is on disk: the SDK tools write it last, and the
 * `sdk list` and AVD tooling treat the package as present only when it exists.
 */
export function isSystemImageInstalled(
  sdkRoot: string,
  systemImage: string,
  pathExists: PathChecker = defaultPathExists,
): Promise<boolean> {
  return pathExists(join(sdkRoot, ...systemImage.split(';'), 'source.properties'))
}

export function resolveInstalledSystemImage(
  requestedSystemImage: string | undefined,
  installedSystemImages: readonly string[],
): string {
  if (!requestedSystemImage) {
    return selectDefaultSystemImage(installedSystemImages)
  }

  if (!installedSystemImages.includes(requestedSystemImage)) {
    throw new Error(
      `System image is not installed: ${requestedSystemImage}\n${formatSystemImageHelp(installedSystemImages)}`,
    )
  }

  return requestedSystemImage
}

/** The default API level wins over the page-size preference, so a 16 KB image on it beats a newer standard one. */
export function selectDefaultSystemImage(installedSystemImages: readonly string[]): string {
  const googlePlaySystemImages = installedSystemImages.filter((systemImage) => {
    const { tagId } = parseSystemImagePackage(systemImage)
    return tagId === 'google_apis_playstore' || tagId === 'google_apis_playstore_ps16k'
  })

  if (googlePlaySystemImages.length === 0) {
    throw new Error(`No supported Android system images found.\n${formatSystemImageHelp(installedSystemImages)}`)
  }

  const defaultPlatformSystemImages = googlePlaySystemImages.filter((systemImage) =>
    isDefaultAndroidApiLevel(parseSystemImagePackage(systemImage).platform),
  )
  const standardSystemImages = googlePlaySystemImages.filter(
    (systemImage) => parseSystemImagePackage(systemImage).tagId === 'google_apis_playstore',
  )
  const candidates =
    defaultPlatformSystemImages.length > 0
      ? defaultPlatformSystemImages
      : standardSystemImages.length > 0
        ? standardSystemImages
        : googlePlaySystemImages

  return sortSystemImagesDefaultFirst(candidates)[0] as string
}

export function sortSystemImagesDefaultFirst(systemImages: readonly string[]): string[] {
  return [...systemImages].sort(compareSystemImagesDefaultFirst)
}

/** Images for the default API level first, then newest first. */
function compareSystemImagesDefaultFirst(left: string, right: string): number {
  const leftPackage = parseSystemImagePackage(left)
  const rightPackage = parseSystemImagePackage(right)
  const defaultComparison =
    Number(isDefaultAndroidApiLevel(rightPackage.platform)) - Number(isDefaultAndroidApiLevel(leftPackage.platform))
  const platformComparison = rightPackage.platform.localeCompare(leftPackage.platform, 'en', { numeric: true })

  return (
    defaultComparison ||
    platformComparison ||
    getSystemImageTagPriority(leftPackage.tagId) - getSystemImageTagPriority(rightPackage.tagId) ||
    left.localeCompare(right)
  )
}

function defaultPathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

function getSystemImageTagPriority(tagId: string): number {
  if (tagId === 'google_apis_playstore') {
    return 0
  }

  if (tagId === 'google_apis_playstore_ps16k') {
    return 1
  }

  return 2
}

function formatSystemImageHelp(installedSystemImages: readonly string[]): string {
  if (installedSystemImages.length === 0) {
    return NO_INSTALLED_SYSTEM_IMAGES_MESSAGE
  }

  return `Installed system images:\n- ${installedSystemImages.join('\n- ')}\nList them with: solana-mobile emulator images list`
}

async function listDirectoryNames(directoryPath: string, readDirectory: DirectoryReader): Promise<string[]> {
  try {
    return (await readDirectory(directoryPath))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}
