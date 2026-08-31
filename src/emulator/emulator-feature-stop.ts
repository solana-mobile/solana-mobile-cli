import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type { EmulatorStopCommandOptions, StopEmulatorDependencies } from './data-access/emulator-types.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { stopEmulator } from './data-access/stop-emulator.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectRunningEmulatorSerial } from './ui/emulator-ui-select-running-emulator-serial.ts'

interface RunEmulatorStopDependencies extends PromptDependencies, StopEmulatorDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorStop(
  options: EmulatorStopCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    runCommand = runExecutable,
    runSelect,
  }: RunEmulatorStopDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator stop')

    let nameOrSerial = options.nameOrSerial

    if (!nameOrSerial) {
      const runningEmulators = await listRunningEmulators({ runCommand })

      if (runningEmulators.length === 0) {
        showNote(formatCommand('emulator start'), 'No running Android emulators found')
        showOutro('Done')
        return
      }

      nameOrSerial = await selectRunningEmulatorSerial(runningEmulators, 'Select a running emulator to stop', runSelect)

      if (!nameOrSerial) {
        return
      }
    }

    const stopped = await stopEmulator(nameOrSerial, { runCommand })

    log(`Stopped emulator: ${stopped.name} (${stopped.serial})`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
