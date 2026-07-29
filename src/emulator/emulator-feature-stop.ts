import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type { EmulatorStopCommandOptions, StopEmulatorDependencies } from './data-access/emulator-types.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { runExecutable } from './data-access/run-executable.ts'
import { stopEmulator } from './data-access/stop-emulator.ts'
import { NO_RUNNING_EMULATORS_MESSAGE } from './ui/emulator-ui-messages.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectRunningEmulatorSerial } from './ui/emulator-ui-select-running-emulator-serial.ts'

interface RunEmulatorStopDependencies extends PromptDependencies, StopEmulatorDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorStop(
  options: EmulatorStopCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
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
        log(NO_RUNNING_EMULATORS_MESSAGE)
        showOutro(`Start one with: ${formatCommand('emulator start')}`)
        return
      }

      nameOrSerial = await selectRunningEmulatorSerial(runningEmulators, runSelect)

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
