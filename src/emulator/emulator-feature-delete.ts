import { homedir } from 'node:os'
import { cancel, intro, note, outro, tasks } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { PromptDependencies } from '../core/ui/core-ui-prompt-types.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { defaultPathExists } from './data-access/create-avd.ts'
import { deleteInstalledAvds } from './data-access/delete-installed-avds.ts'
import type {
  DeleteInstalledAvdsDependencies,
  EmulatorDeleteCommandOptions,
  ListInstalledAvdsDependencies,
} from './data-access/emulator-types.ts'
import { defaultReadDirectory, defaultReadTextFile, listInstalledAvds } from './data-access/list-installed-avds.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { selectInstalledEmulatorNames } from './ui/emulator-ui-select-installed-emulator-names.ts'

interface RunEmulatorDeleteDependencies
  extends DeleteInstalledAvdsDependencies,
    ListInstalledAvdsDependencies,
    PromptDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
  tasks?: typeof tasks
}

export async function runEmulatorDelete(
  options: EmulatorDeleteCommandOptions,
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    getHomeDirectory = homedir,
    intro: showIntro = intro,
    note: showNote = note,
    outro: showOutro = outro,
    pathExists = defaultPathExists(),
    readDirectory = defaultReadDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    runMultiselect,
    tasks: runTasks = tasks,
  }: RunEmulatorDeleteDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator delete')

    let names = options.names && options.names.length > 0 ? options.names : undefined

    if (!names) {
      const avds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })

      if (avds.length === 0) {
        showNote(formatCommand('emulator create'), 'No Android emulators found')
        showOutro('Done')
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

    /**
     * The tasks below must never reject: `tasks()` stops its spinner only once the task resolves, and a live clack
     * spinner keeps a `setInterval` and a raw-mode stdin listener attached, which holds the event loop open forever.
     * Failures are collected and rethrown after `runTasks` resolves so the process can actually exit.
     */
    const failures: string[] = []

    await runTasks(
      names.map((name) => ({
        task: async () => {
          try {
            const result = await deleteInstalledAvds([name], options.sdkRoot, {
              getHomeDirectory,
              pathExists,
              runCommand,
            })

            if (result.failures.length > 0) {
              failures.push(...result.failures)
              return `Could not delete emulator: ${name}`
            }

            return result.notInstalled.length > 0 ? `Emulator not installed: ${name}` : `Deleted emulator: ${name}`
          } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : error}`)
            return `Could not delete emulator: ${name}`
          }
        },
        title: `Deleting ${name}`,
      })),
    )

    if (failures.length > 0) {
      throw new Error(`Some emulators could not be deleted:\n- ${failures.join('\n- ')}`)
    }

    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
