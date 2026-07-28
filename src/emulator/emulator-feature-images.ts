import { cancel, intro, outro } from '@clack/prompts'
import { systemImagePackageToRelativeDirectory } from './data-access/avd-config.ts'
import type {
  DirectoryReader,
  EmulatorImagesCommandOptions,
  EmulatorImagesInstallCommandOptions,
  PathChecker,
} from './data-access/emulator-types.ts'
import {
  listInstalledSystemImages,
  NO_INSTALLED_SYSTEM_IMAGES_MESSAGE,
} from './data-access/list-installed-system-images.ts'
import { resolveAndroidSdkRoot } from './data-access/resolve-android-sdk-root.ts'
import {
  filterCompatibleSystemImages,
  installSystemImage,
  listAvailableSystemImages,
  normalizeSystemImagePackage,
  type SystemImagePackageManagerDependencies,
} from './data-access/system-image-package-manager.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectSystemImage } from './ui/emulator-ui-select-system-image.ts'

interface RunEmulatorImagesDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
}

interface RunEmulatorImagesInstallDependencies extends PromptDependencies, SystemImagePackageManagerDependencies {
  architecture?: string
  cancel?: (message: string) => void
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorImages(
  options: EmulatorImagesCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    log = console.log,
    outro: showOutro = outro,
    pathExists,
    readDirectory,
  }: RunEmulatorImagesDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator images')

    const systemImages = await listInstalledSystemImages(options.sdkRoot ?? resolveAndroidSdkRoot(), {
      pathExists,
      readDirectory,
    })

    if (systemImages.length === 0) {
      log(NO_INSTALLED_SYSTEM_IMAGES_MESSAGE)
      showOutro('Done')
      return
    }

    for (const systemImage of systemImages) {
      log(systemImage)
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

export async function runEmulatorImagesInstall(
  options: EmulatorImagesInstallCommandOptions = {},
  {
    architecture = process.arch,
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    log = console.log,
    outro: showOutro = outro,
    pathExists,
    readDirectory,
    runCommand,
    runInteractiveCommand,
    runSelect,
  }: RunEmulatorImagesInstallDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator images install')

    const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
    const requestedSystemImage = options.systemImage ? normalizeSystemImagePackage(options.systemImage) : undefined
    const installedSystemImages = await listInstalledSystemImages(sdkRoot, { pathExists, readDirectory })

    if (requestedSystemImage && installedSystemImages.includes(requestedSystemImage)) {
      log(`System image is already installed: ${requestedSystemImage}`)
      showOutro('Done')
      return
    }

    const availableSystemImages = await listAvailableSystemImages(sdkRoot, {
      pathExists,
      readDirectory,
      runCommand,
    })
    const compatibleSystemImages = filterCompatibleSystemImages(availableSystemImages, architecture)
    const installableSystemImages = compatibleSystemImages.filter(
      (systemImage) => !installedSystemImages.includes(systemImage),
    )

    if (requestedSystemImage && !installableSystemImages.includes(requestedSystemImage)) {
      throw new Error(
        `System image is not available: ${requestedSystemImage}\n${formatAvailableSystemImages(installableSystemImages)}`,
      )
    }

    if (installableSystemImages.length === 0) {
      log(`No uninstalled Google Play system images are available for ${architecture}.`)
      showOutro('Done')
      return
    }

    const systemImage = requestedSystemImage ?? (await selectSystemImage(installableSystemImages, runSelect))

    if (!systemImage) {
      return
    }

    await installSystemImage(systemImage, sdkRoot, {
      pathExists,
      readDirectory,
      runInteractiveCommand,
    })
    log(`Installed system image: ${systemImage}`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

function formatAvailableSystemImages(systemImages: readonly string[]): string {
  if (systemImages.length === 0) {
    return 'No compatible Google Play system images are available.'
  }

  return `Available compatible Google Play system images:\n- ${systemImages
    .map(systemImagePackageToRelativeDirectory)
    .join('\n- ')}`
}
