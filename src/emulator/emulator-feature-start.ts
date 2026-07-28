import { homedir } from 'node:os'
import { cancel, intro, outro } from '@clack/prompts'
import type { EmulatorStartCommandOptions, StartEmulatorDependencies } from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile, listInstalledAvds } from './data-access/list-installed-avds.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectInstalledEmulatorName } from './ui/emulator-ui-select-installed-emulator-name.ts'

interface RunEmulatorStartDependencies extends PromptDependencies, StartEmulatorDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorStart(
  options: EmulatorStartCommandOptions = {},
  {
    cancel: showCancel = cancel,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    outro: showOutro = outro,
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runSelect,
    startProcess = defaultStartProcess,
  }: RunEmulatorStartDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator start')

    const name =
      options.name ??
      (await selectInstalledEmulatorName(
        await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile }),
        'Select an emulator to start',
        runSelect,
      ))

    if (!name) {
      return
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
    console.log(`Started emulator: ${name}`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
