import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type { EmulatorStartCommandOptions, StartEmulatorDependencies } from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile, listInstalledAvds } from './data-access/list-installed-avds.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectInstalledEmulatorName } from './ui/emulator-ui-select-installed-emulator-name.ts'

interface RunEmulatorStartDependencies extends PromptDependencies, StartEmulatorDependencies {
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
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runSelect,
    startProcess = defaultStartProcess,
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
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
