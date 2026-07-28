import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSystemImagePackage } from './avd-config.ts'
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

        if (await pathExists(join(systemImagesRoot, platform, tag, architecture, 'source.properties'))) {
          systemImages.push(systemImage)
        }
      }
    }
  }

  return systemImages.sort((left, right) => left.localeCompare(right))
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

export function selectDefaultSystemImage(installedSystemImages: readonly string[]): string {
  const standardSystemImages = installedSystemImages.filter(
    (systemImage) => parseSystemImagePackage(systemImage).tagId === 'google_apis_playstore',
  )
  const sixteenKilobyteSystemImages = installedSystemImages.filter(
    (systemImage) => parseSystemImagePackage(systemImage).tagId === 'google_apis_playstore_ps16k',
  )
  const googlePlaySystemImages = standardSystemImages.length > 0 ? standardSystemImages : sixteenKilobyteSystemImages

  if (googlePlaySystemImages.length === 0) {
    throw new Error(`No supported Android system images found.\n${formatSystemImageHelp(installedSystemImages)}`)
  }

  return sortSystemImagesNewestFirst(googlePlaySystemImages)[0] as string
}

export function sortSystemImagesNewestFirst(systemImages: readonly string[]): string[] {
  return [...systemImages].sort(compareSystemImagesNewestFirst)
}

function compareSystemImagesNewestFirst(left: string, right: string): number {
  const leftPackage = parseSystemImagePackage(left)
  const rightPackage = parseSystemImagePackage(right)
  const platformComparison = rightPackage.platform.localeCompare(leftPackage.platform, 'en', { numeric: true })

  return (
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
