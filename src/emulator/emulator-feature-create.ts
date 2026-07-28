import { homedir } from 'node:os'
import { cancel, intro, outro } from '@clack/prompts'
import { resolveEmulatorProfile } from './data-access/avd-config.ts'
import { createAvd, defaultPathExists, defaultWriteTextFile } from './data-access/create-avd.ts'
import type {
  CreateAvdDependencies,
  EmulatorCreateCommandOptions,
  StartEmulatorDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile } from './data-access/list-installed-avds.ts'
import { runExecutable } from './data-access/run-executable.ts'
import { defaultStartProcess, startEmulator } from './data-access/start-emulator.ts'
import { promptEmulatorName } from './ui/emulator-ui-prompt-emulator-name.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'

interface RunEmulatorCreateDependencies extends CreateAvdDependencies, PromptDependencies, StartEmulatorDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorCreate(
  options: EmulatorCreateCommandOptions = {},
  {
    cancel: showCancel = cancel,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    outro: showOutro = outro,
    pathExists = defaultPathExists(),
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runText,
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

    console.log(`Preparing emulator: ${name}`)

    const result = await createAvd(
      {
        ...options,
        name,
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
      console.log(`Emulator already exists: ${result.name}`)
      console.log(`To recreate, delete it first with: solana-mobile emulator delete ${result.name}`)
      showOutro('Done')
      return
    }

    console.log(`Created emulator: ${result.name}`)

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
      console.log(`Started emulator: ${result.name}`)
      showOutro('Done')
      return
    }

    console.log(`Start with: solana-mobile emulator start ${result.name}`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
