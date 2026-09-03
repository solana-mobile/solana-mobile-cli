import { Command, InvalidArgumentError } from 'commander'
import { parseIntegerOption } from '../core/ui/core-ui-command-options.ts'
import { parseLocalnetEngineId } from './data-access/localnet-engines.ts'
import type {
  LocalnetCheckCommandOptions,
  LocalnetEngineId,
  LocalnetForwardCommandOptions,
  LocalnetLogsCommandOptions,
  LocalnetStartCommandOptions,
  LocalnetStatusCommandOptions,
  LocalnetStopCommandOptions,
} from './data-access/localnet-types.ts'
import { runLocalnetCheck } from './localnet-feature-check.ts'
import { runLocalnetForward } from './localnet-feature-forward.ts'
import { runLocalnetLogs } from './localnet-feature-logs.ts'
import { runLocalnetStart } from './localnet-feature-start.ts'
import { runLocalnetStatus } from './localnet-feature-status.ts'
import { runLocalnetStop } from './localnet-feature-stop.ts'

export type LocalnetCommandDeps = {
  runLocalnetCheck?: (options: LocalnetCheckCommandOptions) => Promise<void>
  runLocalnetForward?: (options: LocalnetForwardCommandOptions) => Promise<void>
  runLocalnetLogs?: (options: LocalnetLogsCommandOptions) => Promise<void>
  runLocalnetStart?: (options: LocalnetStartCommandOptions) => Promise<void>
  runLocalnetStatus?: (options: LocalnetStatusCommandOptions) => Promise<void>
  runLocalnetStop?: (options: LocalnetStopCommandOptions) => Promise<void>
}

export function createLocalnetCommand({
  runLocalnetCheck: runLocalnetCheckCommand = runLocalnetCheck,
  runLocalnetForward: runLocalnetForwardCommand = runLocalnetForward,
  runLocalnetLogs: runLocalnetLogsCommand = runLocalnetLogs,
  runLocalnetStart: runLocalnetStartCommand = runLocalnetStart,
  runLocalnetStatus: runLocalnetStatusCommand = runLocalnetStatus,
  runLocalnetStop: runLocalnetStopCommand = runLocalnetStop,
}: LocalnetCommandDeps = {}): Command {
  const localnetCommand = withLocalnetTargetOptions(
    new Command('localnet').description('Run a local Solana validator for emulators and devices'),
  )
    .option('--detach', 'Leave the validator running in the background')
    .option('--image <image>', 'Container image to run')
    .option('--no-watch', 'Do not re-apply port forwards when devices change')
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      await runLocalnetStartCommand(toLocalnetStartOptions(localnetOptions(command)))
    })

  withLocalnetTargetOptions(localnetCommand.command('start').description('Start the validator and forward its ports'))
    .option('--detach', 'Leave the validator running in the background')
    .option('--image <image>', 'Container image to run')
    .option('--no-watch', 'Do not re-apply port forwards when devices change')
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      await runLocalnetStartCommand(toLocalnetStartOptions(localnetOptions(command)))
    })

  withLocalnetTargetOptions(
    localnetCommand.command('check').description('Verify the validator is reachable from every device'),
  )
    .option('--json', 'Print a stable JSON report')
    .option('--open', 'Also open the Studio UI in the device browser')
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      const options = localnetOptions(command)

      await runLocalnetCheckCommand({ ...toLocalnetTargetOptions(options), json: options.json, open: options.open })
    })

  withLocalnetTargetOptions(
    localnetCommand.command('forward').description('Forward validator ports to connected devices'),
  )
    .option('--watch', 'Keep re-applying port forwards when devices change')
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      const options = localnetOptions(command)

      await runLocalnetForwardCommand({ ...toLocalnetTargetOptions(options), watch: options.watch })
    })

  localnetCommand
    .command('logs')
    .description('Print validator logs')
    .option('--lines <count>', 'Number of lines to print', parseIntegerOption)
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      await runLocalnetLogsCommand({ lines: localnetOptions(command).lines })
    })

  withLocalnetTargetOptions(localnetCommand.command('status').description('Show validator and port forward status'))
    .option('--json', 'Print a stable JSON report')
    .action(async (_options: LocalnetCommandLineOptions, command: Command) => {
      const options = localnetOptions(command)

      await runLocalnetStatusCommand({ ...toLocalnetTargetOptions(options), json: options.json })
    })

  withLocalnetTargetOptions(
    localnetCommand.command('stop').description('Stop the validator and remove its port forwards'),
  ).action(async (_options: LocalnetCommandLineOptions, command: Command) => {
    await runLocalnetStopCommand(toLocalnetTargetOptions(localnetOptions(command)))
  })

  return localnetCommand
}

interface LocalnetCommandLineOptions {
  detach?: boolean
  device?: string[]
  engine?: LocalnetEngineId
  image?: string
  json?: boolean
  lines?: number
  open?: boolean
  port?: number
  studioPort?: number
  watch?: boolean
  wsPort?: number
}

function collectDevice(value: string, previous: string[] = []) {
  return [...previous, value]
}

/**
 * Collects a localnet command's options from every level that could have parsed them.
 *
 * `localnet` and each of its subcommands declare the same flags, so both `localnet --port 9899 status`
 * and `localnet status --port 9899` are accepted — but commander stores a flag on whichever command
 * parsed it, and a subcommand action only sees its own. Reading one level therefore silently dropped
 * every flag written on the other side of the subcommand.
 *
 * Merging whole `opts()` objects does not fix it: every level carries defaults (`--device` defaults to
 * `[]`, `--no-watch` to `true`), so one level's default overwrites the other level's real input. Only
 * explicitly sourced values are merged, innermost level first.
 */
function localnetOptions(command: Command): LocalnetCommandLineOptions {
  const merged: Record<string, unknown> = {}
  const explicit = new Set<string>()

  for (let current: Command | null = command; current; current = current.parent) {
    for (const [key, value] of Object.entries(current.opts())) {
      const isExplicit = !['default', undefined].includes(current.getOptionValueSource(key))

      if (explicit.has(key) || (key in merged && !isExplicit)) {
        continue
      }

      merged[key] = value

      if (isExplicit) {
        explicit.add(key)
      }
    }
  }

  return merged as LocalnetCommandLineOptions
}

/**
 * Commander only renders a concise usage error for `InvalidArgumentError`; anything else escapes parsing
 * and the built CLI prints a stack trace. The engine parser itself stays free of Commander so it can be
 * used outside the CLI boundary.
 */
function parseEngineOption(value: string): LocalnetEngineId {
  try {
    return parseLocalnetEngineId(value)
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error))
  }
}

function withLocalnetTargetOptions(command: Command): Command {
  return command
    .option('--device <serial>', 'Target a device serial (repeatable)', collectDevice, [])
    .option('--engine <engine>', 'Validator engine: surfpool or test-validator', parseEngineOption)
    .option('--port <port>', 'Host port for the RPC endpoint', parseIntegerOption)
    .option('--studio-port <port>', 'Host port for the Studio UI', parseIntegerOption)
    .option('--ws-port <port>', 'Host port for the WebSocket endpoint', parseIntegerOption)
}

function toLocalnetTargetOptions(options: LocalnetCommandLineOptions) {
  return {
    devices: options.device,
    engine: options.engine,
    port: options.port,
    studioPort: options.studioPort,
    wsPort: options.wsPort,
  }
}

function toLocalnetStartOptions(options: LocalnetCommandLineOptions): LocalnetStartCommandOptions {
  return { ...toLocalnetTargetOptions(options), detach: options.detach, image: options.image, watch: options.watch }
}
