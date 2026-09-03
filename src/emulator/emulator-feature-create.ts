import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, note, outro, tasks } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { resolveEmulatorProfile } from './data-access/avd-config.ts'
import { createAvd, defaultPathExists, defaultWriteTextFile, getAvdDirectoryPath } from './data-access/create-avd.ts'
import type {
  CreateAvdDependencies,
  CreateAvdResult,
  EmulatorCreateCommandOptions,
  StartEmulatorDependencies,
  WaitForEmulatorBootDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile } from './data-access/list-installed-avds.ts'
import { listInstalledSystemImages, resolveInstalledSystemImage } from './data-access/list-installed-system-images.ts'
import { resolveAndroidSdkRoot } from './data-access/resolve-android-sdk-root.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import { type InstallEmulatorSystemImageDependencies, installEmulatorSystemImage } from './emulator-feature-images.ts'
import { waitAndTuneEmulator } from './emulator-feature-tune.ts'
import { promptEmulatorName } from './ui/emulator-ui-prompt-emulator-name.ts'

interface RunEmulatorCreateDependencies
  extends CreateAvdDependencies,
    InstallEmulatorSystemImageDependencies,
    StartEmulatorDependencies,
    WaitForEmulatorBootDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  tasks?: typeof tasks
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
    note: showNote = note,
    outro: showOutro = outro,
    pathExists = defaultPathExists(),
    pollIntervalMs,
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runInteractiveCommand,
    runSelect,
    runText,
    sleep,
    spinner,
    startProcess = defaultStartProcess,
    timeoutMs,
    taskLog,
    tasks: runTasks = tasks,
    writeTextFile = defaultWriteTextFile,
  }: RunEmulatorCreateDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator create')

    if (options.tune && !options.start) {
      throw new Error(
        `Cannot tune an emulator that is not started: --tune requires --start\nTune it later with: ${formatCommand('emulator tune')}`,
      )
    }

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
            spinner,
            taskLog,
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

    let result!: CreateAvdResult

    await runTasks([
      {
        task: async () => {
          result = await createAvd(
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

          return result.created ? `Created emulator: ${result.name}` : `Emulator already exists: ${result.name}`
        },
        title: `Creating emulator: ${name}`,
      },
    ])

    if (!result.created) {
      showNote(formatCommand(`emulator delete ${result.name}`), 'Delete it first to recreate')
      showOutro('Done')
      return
    }

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

      if (options.tune) {
        await waitAndTuneEmulator(result.name, {
          formatCommand,
          log,
          note: showNote,
          pollIntervalMs,
          runCommand,
          sleep,
          timeoutMs,
        })
      } else {
        showNote(formatCommand(`emulator tune ${result.name}`), 'Apply agent-friendly tweaks')
      }

      showOutro('Done')
      return
    }

    showNote(formatCommand(`emulator start ${result.name}`), 'Start the emulator')
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
