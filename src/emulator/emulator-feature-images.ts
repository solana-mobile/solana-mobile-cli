import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, note, outro, spinner, taskLog } from '@clack/prompts'
import { resolveAndroidSdkRoot } from '../core/data-access/android-sdk-root.ts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { PromptDependencies } from '../core/ui/core-ui-prompt-types.ts'
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
import {
  filterCompatibleSystemImages,
  installSystemImage,
  normalizeSystemImagePackage,
  resolveAndroidSdkPackageManager,
  type SystemImagePackageManagerDependencies,
  uninstallSystemImages,
} from './data-access/system-image-package-manager.ts'
import {
  defaultFetchText,
  type ListAvailableSystemImagesDependencies,
  listAvailableSystemImages,
} from './data-access/system-image-repository.ts'
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
  extends ListAvailableSystemImagesDependencies,
    PromptDependencies,
    SystemImagePackageManagerDependencies {
  architecture?: string
  log?: (message: string) => void
  spinner?: typeof spinner
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
    platform,
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

    // The log wraps the whole removal so that a tool crash after the images are gone still ends in success.
    const deleteLog = options.verbose ? undefined : createTaskLog({ title: 'Deleting Android system images' })

    try {
      await uninstallSystemImages(systemImages, sdkRoot, {
        pathExists,
        platform,
        readDirectory,
        runInteractiveCommand: options.verbose
          ? runInteractiveCommand
          : async (command: [string, ...string[]]) => {
              const output = await runCommand(command)
              if (output) deleteLog?.message(output)
              return output
            },
      })
      deleteLog?.success('Deleted Android system images')
    } catch (error) {
      deleteLog?.error(error instanceof Error ? error.message : String(error))
      throw error
    }

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
    fetchText = defaultFetchText,
    log = clackLog.message,
    pathExists,
    platform,
    readDirectory,
    runCommand = runExecutable,
    runInteractiveCommand,
    runSelect,
    spinner: createSpinner = spinner,
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

  // Fail before the download and the prompt when nothing could install the chosen image.
  await resolveAndroidSdkPackageManager(sdkRoot, { pathExists, platform, readDirectory })

  let availableSystemImages: string[]

  if (options.verbose) {
    const fetchLog = createTaskLog({ title: 'Fetching available system images' })

    try {
      availableSystemImages = await listAvailableSystemImages({
        fetchText: async (url) => {
          fetchLog.message(url)
          return fetchText(url)
        },
      })
      fetchLog.success('Fetched available system images')
    } catch (error) {
      fetchLog.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  } else {
    const fetchSpinner = createSpinner()
    fetchSpinner.start('Fetching available system images')

    try {
      availableSystemImages = await listAvailableSystemImages({ fetchText })
      fetchSpinner.stop('Fetched available system images')
    } catch (error) {
      fetchSpinner.error(error instanceof Error ? error.message : String(error))
      throw error
    }
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

  if (installableSystemImages.length === 0) {
    log(`No system images are available to install on ${architecture}.`)
    return
  }

  const systemImage = requestedSystemImage ?? (await selectSystemImage(installableSystemImages, runSelect))

  if (!systemImage) {
    return
  }

  // The spinner wraps the whole install so that an installer crash after a complete install still ends in success.
  const installSpinner = options.verbose ? undefined : createSpinner()
  installSpinner?.start('Installing Android system image')

  try {
    await installSystemImage(systemImage, sdkRoot, {
      pathExists,
      platform,
      readDirectory,
      runInteractiveCommand: options.verbose ? runInteractiveCommand : runCommand,
    })
    installSpinner?.stop('Installed Android system image')
  } catch (error) {
    installSpinner?.error(error instanceof Error ? error.message : String(error))
    throw error
  }

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
