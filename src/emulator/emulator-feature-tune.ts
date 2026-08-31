import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type {
  AppliedEmulatorTweaks,
  EmulatorTuneCommandOptions,
  RunningEmulator,
  TuneEmulatorDependencies,
  WaitForEmulatorBootDependencies,
} from './data-access/emulator-types.ts'
import { listRunningEmulators } from './data-access/list-running-emulators.ts'
import { applyEmulatorTweaks, tuneEmulator, waitForEmulatorBoot } from './data-access/tune-emulator.ts'
import type { PromptDependencies } from './ui/emulator-ui-prompt-types.ts'
import { selectRunningEmulatorSerial } from './ui/emulator-ui-select-running-emulator-serial.ts'

interface RunEmulatorTuneDependencies extends PromptDependencies, TuneEmulatorDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

function formatAppliedTweaks(emulator: RunningEmulator, { applied, skipped }: AppliedEmulatorTweaks): string {
  return [
    `Tuned emulator: ${emulator.name} (${emulator.serial})`,
    ...applied.map((tweak) => `- ${tweak.name}: ${tweak.description}`),
    ...skipped.map(({ reason, tweak }) => `- ${tweak.name}: skipped (${reason})`),
  ].join('\n')
}

export async function runEmulatorTune(
  options: EmulatorTuneCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    runCommand = runExecutable,
    runSelect,
  }: RunEmulatorTuneDependencies = {},
) {
  try {
    showIntro('solana-mobile emulator tune')

    let nameOrSerial = options.nameOrSerial

    if (!nameOrSerial) {
      const runningEmulators = await listRunningEmulators({ runCommand })

      if (runningEmulators.length === 0) {
        showNote(formatCommand('emulator start'), 'No running Android emulators found')
        showOutro('Done')
        return
      }

      nameOrSerial = await selectRunningEmulatorSerial(runningEmulators, 'Select a running emulator to tune', runSelect)

      if (!nameOrSerial) {
        return
      }
    }

    const { applied, emulator, skipped } = await tuneEmulator(nameOrSerial, { runCommand })

    log(formatAppliedTweaks(emulator, { applied, skipped }))
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

export interface WaitAndTuneEmulatorDependencies extends WaitForEmulatorBootDependencies {
  formatCommand?: typeof formatCliCommand
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
}

export async function waitAndTuneEmulator(
  name: string,
  {
    formatCommand = formatCliCommand,
    log = clackLog.message,
    note: showNote = note,
    pollIntervalMs,
    runCommand = runExecutable,
    sleep,
    timeoutMs,
  }: WaitAndTuneEmulatorDependencies = {},
) {
  try {
    log(`Waiting for emulator to boot: ${name}`)

    const emulator = await waitForEmulatorBoot(name, { pollIntervalMs, runCommand, sleep, timeoutMs })
    const result = await applyEmulatorTweaks(emulator.serial, { runCommand })

    log(formatAppliedTweaks(emulator, result))
  } catch (error) {
    showNote(
      `${error}\nApply the tweaks manually with: ${formatCommand(`emulator tune ${name}`)}`,
      'Emulator tune skipped',
    )
  }
}
