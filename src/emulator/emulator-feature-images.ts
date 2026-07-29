import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, note, outro, taskLog } from '@clack/prompts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { systemImagePackageToRelativeDirectory } from './data-access/avd-config.ts'
import type {
  DirectoryReader,
  EmulatorImagesCommandOptions,
  EmulatorImagesDeleteCommandOptions,
  EmulatorImagesInstallCommandOptions,
  ListInstalledAvdsDependencies,
  PathChecker,
} from './data-access/emulator-types.ts'
import { listInstalledAvds } from './data-access/list-installed-avds.ts'
import { listInstalledSystemImages, resolveInstalledSystemImage } from './data-access/list-installed-system-images.ts'
import { resolveAndroidSdkRoot } from './data-access/resolve-android-sdk-root.ts'
import { runExecutable } from './data-access/run-executable.ts'
import {
  filterCompatibleSystemImages,
  filterSystemImagesForPlatform,
  installSystemImage,
  listAvailableSystemImages,
  listInstalledAndroidPlatforms,
  normalizeSystemImagePackage,
  type SystemImagePackageManagerDependencies,
  uninstallSystemImages,
} from './data-access/system-image-package-manager.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectInstalledSystemImages } from './ui/emulator-ui-select-installed-system-images.ts'
import { selectSystemImage } from './ui/emulator-ui-select-system-image.ts'

interface RunEmulatorImagesDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
}

interface RunEmulatorImagesDeleteDependencies
  extends ListInstalledAvdsDependencies,
    PromptDependencies,
    SystemImagePackageManagerDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  taskLog?: typeof taskLog
}

export interface InstallEmulatorSystemImageDependencies
  extends PromptDependencies,
    SystemImagePackageManagerDependencies {
  architecture?: string
  log?: (message: string) => void
  taskLog?: typeof taskLog
}

interface RunEmulatorImagesInstallDependencies extends InstallEmulatorSystemImageDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorImages(
  options: EmulatorImagesCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    pathExists,
    readDirectory,
  }: RunEmulatorImagesDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator images list')

    const systemImages = await listInstalledSystemImages(options.sdkRoot ?? resolveAndroidSdkRoot(), {
      pathExists,
      readDirectory,
    })

    if (systemImages.length === 0) {
      renderNoInstalledSystemImages(showNote, showOutro, formatCommand)
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

export async function runEmulatorImagesDelete(
  options: EmulatorImagesDeleteCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    pathExists,
    readDirectory,
    readTextFile,
    runCommand = runExecutable,
    runInteractiveCommand,
    runMultiselect,
    taskLog: createTaskLog = taskLog,
  }: RunEmulatorImagesDeleteDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator images delete')

    const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
    const installedSystemImages = await listInstalledSystemImages(sdkRoot, { pathExists, readDirectory })

    if (installedSystemImages.length === 0) {
      renderNoInstalledSystemImages(showNote, showOutro, formatCommand)
      return
    }

    const requestedSystemImages = [...new Set((options.systemImages ?? []).map(normalizeSystemImagePackage))].sort(
      (left, right) => left.localeCompare(right),
    )
    const systemImages =
      requestedSystemImages.length > 0
        ? requestedSystemImages.map((systemImage) => resolveInstalledSystemImage(systemImage, installedSystemImages))
        : await selectInstalledSystemImages(installedSystemImages, runMultiselect)

    if (!systemImages) {
      return
    }

    if (systemImages.length === 0) {
      showOutro('Done')
      return
    }

    const avds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })
    const usedSystemImages = systemImages.flatMap((systemImage) => {
      const emulatorNames = avds
        .filter((avd) => avd.systemImage === systemImage)
        .map((avd) => avd.name)
        .sort((left, right) => left.localeCompare(right))

      return emulatorNames.length > 0 ? [{ emulatorNames, systemImage }] : []
    })

    if (usedSystemImages.length > 0) {
      throw new Error(
        `Cannot delete system images used by Android emulators:\n- ${usedSystemImages
          .map(
            ({ emulatorNames, systemImage }) =>
              `${systemImagePackageToRelativeDirectory(systemImage)}: ${emulatorNames.join(', ')}`,
          )
          .join('\n- ')}\nDelete the listed emulators first.`,
      )
    }

    const runSystemImageUninstall = options.verbose
      ? runInteractiveCommand
      : async (command: [string, ...string[]]) => {
          const deleteLog = createTaskLog({ title: 'Deleting Android system images' })

          try {
            const output = await runCommand(command)
            if (output) deleteLog.message(output)
            deleteLog.success('Deleted Android system images')
          } catch (error) {
            deleteLog.error(error instanceof Error ? error.message : String(error))
            throw error
          }
        }

    await uninstallSystemImages(systemImages, sdkRoot, {
      pathExists,
      readDirectory,
      runInteractiveCommand: runSystemImageUninstall,
    })

    for (const systemImage of systemImages) {
      log(`Deleted system image: ${systemImage}`)
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

export async function runEmulatorImagesInstall(
  options: EmulatorImagesInstallCommandOptions = {},
  dependencies: RunEmulatorImagesInstallDependencies = {},
) {
  const { cancel: showCancel = cancel, intro: showIntro = intro, outro: showOutro = outro } = dependencies

  try {
    showIntro('solana-mobile emulator images install')

    const systemImage = await installEmulatorSystemImage(options, dependencies)

    if (systemImage || !process.exitCode) {
      showOutro('Done')
    }
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

export async function installEmulatorSystemImage(
  options: EmulatorImagesInstallCommandOptions = {},
  {
    architecture = process.arch,
    log = clackLog.message,
    pathExists,
    readDirectory,
    runCommand = runExecutable,
    runInteractiveCommand,
    runSelect,
    taskLog: createTaskLog = taskLog,
  }: InstallEmulatorSystemImageDependencies = {},
): Promise<string | undefined> {
  const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
  const requestedSystemImage = options.systemImage ? normalizeSystemImagePackage(options.systemImage) : undefined
  const installedSystemImages = await listInstalledSystemImages(sdkRoot, { pathExists, readDirectory })

  if (requestedSystemImage && installedSystemImages.includes(requestedSystemImage)) {
    log(`System image is already installed: ${requestedSystemImage}`)
    return requestedSystemImage
  }

  const latestAndroidPlatform =
    requestedSystemImage || options.all
      ? undefined
      : (await listInstalledAndroidPlatforms(sdkRoot, { readDirectory }))[0]

  if (!requestedSystemImage && !options.all && !latestAndroidPlatform) {
    log('No Android SDK platforms are installed.')
    return
  }

  const fetchLog = createTaskLog({ title: 'Fetching available system images' })
  let availableSystemImages: string[]

  try {
    availableSystemImages = await listAvailableSystemImages(sdkRoot, {
      pathExists,
      readDirectory,
      runCommand: async (command) => {
        const output = await runCommand(command)
        if (output) fetchLog.message(output)
        return output
      },
    })
    fetchLog.success('Fetched available system images')
  } catch (error) {
    fetchLog.error(error instanceof Error ? error.message : String(error))
    throw error
  }

  const compatibleSystemImages = filterCompatibleSystemImages(availableSystemImages, architecture)
  const installableSystemImages = compatibleSystemImages.filter(
    (systemImage) => !installedSystemImages.includes(systemImage),
  )

  if (requestedSystemImage && !installableSystemImages.includes(requestedSystemImage)) {
    throw new Error(
      `System image is not available: ${requestedSystemImage}\n${formatAvailableSystemImages(installableSystemImages)}`,
    )
  }

  const selectableSystemImages = latestAndroidPlatform
    ? filterSystemImagesForPlatform(installableSystemImages, latestAndroidPlatform)
    : installableSystemImages

  if (selectableSystemImages.length === 0) {
    log(
      latestAndroidPlatform
        ? `No system images are available to install for ${latestAndroidPlatform}.`
        : `No system images are available to install on ${architecture}.`,
    )
    return
  }

  const systemImage = requestedSystemImage ?? (await selectSystemImage(selectableSystemImages, runSelect))

  if (!systemImage) {
    return
  }

  const runSystemImageInstall = options.verbose
    ? runInteractiveCommand
    : async (command: [string, ...string[]]) => {
        const installLog = createTaskLog({ title: 'Installing Android system image' })

        try {
          const output = await runCommand(command)
          if (output) installLog.message(output)
          installLog.success('Installed Android system image')
        } catch (error) {
          installLog.error(error instanceof Error ? error.message : String(error))
          throw error
        }
      }

  await installSystemImage(systemImage, sdkRoot, {
    pathExists,
    readDirectory,
    runInteractiveCommand: runSystemImageInstall,
  })
  log(`Installed system image: ${systemImage}`)
  return systemImage
}

function formatAvailableSystemImages(systemImages: readonly string[]): string {
  if (systemImages.length === 0) {
    return 'No system images are available for this host.'
  }

  return `Available system images:\n- ${systemImages.map(systemImagePackageToRelativeDirectory).join('\n- ')}`
}

function renderNoInstalledSystemImages(
  showNote: (message: string, title?: string) => void,
  showOutro: (message: string) => void,
  formatCommand: typeof formatCliCommand,
) {
  showNote(formatCommand('emulator images install'), 'No Android system images installed')
  showOutro('Done')
}
