import { cancel, intro, outro } from '@clack/prompts'
import type { EmulatorStopCommandOptions, StopEmulatorDependencies } from './data-access/emulator-types.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { runExecutable } from './data-access/run-executable.ts'
import { stopEmulator } from './data-access/stop-emulator.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectRunningEmulatorSerial } from './ui/emulator-ui-select-running-emulator-serial.ts'

interface RunEmulatorStopDependencies extends PromptDependencies, StopEmulatorDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorStop(
  options: EmulatorStopCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    outro: showOutro = outro,
    runCommand = runExecutable,
    runSelect,
  }: RunEmulatorStopDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator stop')

    const nameOrSerial =
      options.nameOrSerial ?? (await selectRunningEmulatorSerial(await listRunningEmulators({ runCommand }), runSelect))

    if (!nameOrSerial) {
      return
    }

    const stopped = await stopEmulator(nameOrSerial, { runCommand })

    console.log(`Stopped emulator: ${stopped.name} (${stopped.serial})`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
