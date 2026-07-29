import { homedir } from 'node:os'
import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { deleteInstalledAvds } from './data-access/delete-installed-avds.ts'
import type {
  DeleteInstalledAvdsDependencies,
  EmulatorDeleteCommandOptions,
  ListInstalledAvdsDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile, listInstalledAvds } from './data-access/list-installed-avds.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { runExecutable } from './data-access/run-executable.ts'
import { NO_INSTALLED_EMULATORS_MESSAGE } from './ui/emulator-ui-messages.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectInstalledEmulatorNames } from './ui/emulator-ui-select-installed-emulator-names.ts'

interface RunEmulatorDeleteDependencies
  extends DeleteInstalledAvdsDependencies,
    ListInstalledAvdsDependencies,
    PromptDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
}

export async function runEmulatorDelete(
  options: EmulatorDeleteCommandOptions,
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runMultiselect,
  }: RunEmulatorDeleteDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator delete')

    let names = options.names && options.names.length > 0 ? options.names : undefined

    if (!names) {
      const avds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })

      if (avds.length === 0) {
        log(NO_INSTALLED_EMULATORS_MESSAGE)
        showOutro(`Create one with: ${formatCommand('emulator create')}`)
        return
      }

      const selected = await selectInstalledEmulatorNames(avds, runMultiselect)

      if (!selected) {
        return
      }

      if (selected.length === 0) {
        showOutro('Done')
        return
      }

      names = selected
    }

    const runningEmulator = (await listRunningEmulators({ runCommand })).find(({ name }) => names.includes(name))

    if (runningEmulator) {
      throw new Error(
        `Cannot delete running emulator: ${runningEmulator.name} (${runningEmulator.serial})\nStop it first with: ${formatCommand(`emulator stop ${runningEmulator.name}`)}`,
      )
    }

    await deleteInstalledAvds(names, options.sdkRoot, { runCommand })

    for (const name of names) {
      log(`Deleted emulator: ${name}`)
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
