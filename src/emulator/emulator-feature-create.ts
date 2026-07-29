import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { resolveEmulatorProfile } from './data-access/avd-config.ts'
import { createAvd, defaultPathExists, defaultWriteTextFile, getAvdDirectoryPath } from './data-access/create-avd.ts'
import type {
  CreateAvdDependencies,
  EmulatorCreateCommandOptions,
  StartEmulatorDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile } from './data-access/list-installed-avds.ts'
import { listInstalledSystemImages, resolveInstalledSystemImage } from './data-access/list-installed-system-images.ts'
import { resolveAndroidSdkRoot } from './data-access/resolve-android-sdk-root.ts'
import { runExecutable } from './data-access/run-executable.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import { type InstallEmulatorSystemImageDependencies, installEmulatorSystemImage } from './emulator-feature-images.ts'
import { promptEmulatorName } from './ui/emulator-ui-prompt-emulator-name.ts'

interface RunEmulatorCreateDependencies
  extends CreateAvdDependencies,
    InstallEmulatorSystemImageDependencies,
    StartEmulatorDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorCreate(
  options: EmulatorCreateCommandOptions = {},
  {
    architecture,
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    pathExists = defaultPathExists(),
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runInteractiveCommand,
    runSelect,
    runText,
    spinner: createSpinner,
    startProcess = defaultStartProcess,
    writeTextFile = defaultWriteTextFile,
  }: RunEmulatorCreateDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator create')

    const profile = resolveEmulatorProfile(options.profile)
    const name = options.name ?? (await promptEmulatorName(profile.name, runText))

    if (!name) {
      return
    }

    const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
    let systemImage = options.systemImage

    if (!(await pathExists(getAvdDirectoryPath(getHomeDirectory(), name)))) {
      const installedSystemImages = await listInstalledSystemImages(sdkRoot, { pathExists, readDirectory })

      try {
        systemImage = resolveInstalledSystemImage(options.systemImage, installedSystemImages)
      } catch {
        systemImage = await installEmulatorSystemImage(
          {
            sdkRoot,
            systemImage: options.systemImage,
            verbose: options.verbose,
          },
          {
            architecture,
            log,
            pathExists,
            readDirectory,
            runCommand,
            runInteractiveCommand,
            runSelect,
            spinner: createSpinner,
          },
        )

        if (!systemImage) {
          if (!process.exitCode) {
            showOutro('Done')
          }
          return
        }
      }
    }

    const result = await createAvd(
      {
        ...options,
        name,
        sdkRoot,
        systemImage,
      },
      {
        getHomeDirectory,
        pathExists,
        readDirectory,
        readTextFile,
        runCommand,
        writeTextFile,
      },
    )

    if (!result.created) {
      log(`Emulator already exists: ${result.name}`)
      log(`To recreate, delete it first with: ${formatCommand(`emulator delete ${result.name}`)}`)
      showOutro('Done')
      return
    }

    log(`Created emulator: ${result.name}`)

    if (options.start) {
      await startEmulator(
        { name: result.name, sdkRoot: result.sdkRoot },
        {
          getHomeDirectory,
          readDirectory,
          readTextFile,
          startProcess,
        },
      )
      log(`Started emulator: ${result.name}`)
      showOutro('Done')
      return
    }

    log(`Start with: ${formatCommand(`emulator start ${result.name}`)}`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
