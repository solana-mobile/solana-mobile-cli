import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type {
  EmulatorStartCommandOptions,
  StartEmulatorDependencies,
  WaitForEmulatorBootDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile, listInstalledAvds } from './data-access/list-installed-avds.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import { waitAndTuneEmulator } from './emulator-feature-tune.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectInstalledEmulatorName } from './ui/emulator-ui-select-installed-emulator-name.ts'

interface RunEmulatorStartDependencies
  extends PromptDependencies,
    StartEmulatorDependencies,
    WaitForEmulatorBootDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorStart(
  options: EmulatorStartCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    pollIntervalMs,
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runSelect,
    sleep,
    startProcess = defaultStartProcess,
    timeoutMs,
  }: RunEmulatorStartDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator start')

    let name = options.name

    if (!name) {
      const avds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })

      if (avds.length === 0) {
        showNote(formatCommand('emulator create'), 'No Android emulators found')
        showOutro('Done')
        return
      }

      name = await selectInstalledEmulatorName(avds, 'Select an emulator to start', runSelect)

      if (!name) {
        return
      }
    }

    await startEmulator(
      {
        name,
        sdkRoot: options.sdkRoot,
      },
      {
        getHomeDirectory,
        readDirectory,
        readTextFile,
        startProcess,
      },
    )
    log(`Started emulator: ${name}`)

    if (options.tune !== false) {
      await waitAndTuneEmulator(name, {
        formatCommand,
        log,
        note: showNote,
        pollIntervalMs,
        runCommand,
        sleep,
        timeoutMs,
      })
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
