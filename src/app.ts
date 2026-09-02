import { Command, InvalidArgumentError, Option } from 'commander'
import { readPackageMetadata } from './core/data-access/package-metadata.ts'
import {
  checkForNewerVersion,
  type VersionCheckOptions,
  type VersionCheckResult,
} from './core/data-access/version-check.ts'
import { formatUpdateWarning } from './core/ui/core-ui-update-warning.ts'
import {
  type CreateCommandOptions,
  extractTemplateOptions,
  MINIMAL_TEMPLATE_NAME,
  parsePackageManagerOption,
  runCreate,
} from './create/create-feature-index.ts'
import {
  type DeviceInstallCommandOptions,
  type DeviceListCommandOptions,
  type DeviceOpenCommandOptions,
  runDeviceInstall,
  runDeviceList,
  runDeviceOpen,
} from './device/device-feature-index.ts'
import type { DoctorCommandOptions } from './doctor/doctor-feature-index.ts'
import { runDoctor } from './doctor/doctor-feature-index.ts'
import {
  type EmulatorCreateCommandOptions,
  type EmulatorDeleteCommandOptions,
  type EmulatorImagesCommandOptions,
  type EmulatorImagesDeleteCommandOptions,
  type EmulatorImagesInstallCommandOptions,
  type EmulatorListCommandOptions,
  type EmulatorStartCommandOptions,
  type EmulatorStatusCommandOptions,
  type EmulatorStopCommandOptions,
  type EmulatorTuneCommandOptions,
  runEmulatorCreate,
  runEmulatorDelete,
  runEmulatorImages,
  runEmulatorImagesDelete,
  runEmulatorImagesInstall,
  runEmulatorList,
  runEmulatorStart,
  runEmulatorStatus,
  runEmulatorStop,
  runEmulatorTune,
} from './emulator/emulator-feature-index.ts'
import {
  type LocalnetCheckCommandOptions,
  type LocalnetEngineId,
  type LocalnetForwardCommandOptions,
  type LocalnetLogsCommandOptions,
  type LocalnetStartCommandOptions,
  type LocalnetStatusCommandOptions,
  type LocalnetStopCommandOptions,
  parseLocalnetEngineId,
  runLocalnetCheck,
  runLocalnetForward,
  runLocalnetLogs,
  runLocalnetStart,
  runLocalnetStatus,
  runLocalnetStop,
} from './localnet/localnet-feature-index.ts'
import {
  runTemplatesCheck,
  runTemplatesGenerate,
  runTemplatesSync,
  type TemplatesCheckCommandOptions,
  type TemplatesGenerateCommandOptions,
  type TemplatesSyncCommandOptions,
} from './templates/templates-feature-index.ts'
import {
  runWebshellBuild,
  runWebshellInit,
  type WebshellBuildCommandOptions,
  type WebshellInitCommandOptions,
} from './webshell/webshell-feature-index.ts'

export type AppOptions = {
  checkForNewerVersion?: (options: VersionCheckOptions) => Promise<VersionCheckResult | undefined>
  runDeviceInstall?: (options: DeviceInstallCommandOptions) => Promise<void>
  runDeviceList?: (options: DeviceListCommandOptions) => Promise<void>
  runDeviceOpen?: (options: DeviceOpenCommandOptions) => Promise<void>
  runEmulatorCreate?: (options: EmulatorCreateCommandOptions) => Promise<void>
  runEmulatorDelete?: (options: EmulatorDeleteCommandOptions) => Promise<void>
  runEmulatorImages?: (options: EmulatorImagesCommandOptions) => Promise<void>
  runEmulatorImagesDelete?: (options: EmulatorImagesDeleteCommandOptions) => Promise<void>
  runEmulatorImagesInstall?: (options: EmulatorImagesInstallCommandOptions) => Promise<void>
  runEmulatorList?: (options: EmulatorListCommandOptions) => Promise<void>
  runEmulatorStart?: (options: EmulatorStartCommandOptions) => Promise<void>
  runEmulatorStatus?: (options: EmulatorStatusCommandOptions) => Promise<void>
  runEmulatorStop?: (options: EmulatorStopCommandOptions) => Promise<void>
  runEmulatorTune?: (options: EmulatorTuneCommandOptions) => Promise<void>
  runLocalnetCheck?: (options: LocalnetCheckCommandOptions) => Promise<void>
  runLocalnetForward?: (options: LocalnetForwardCommandOptions) => Promise<void>
  runLocalnetLogs?: (options: LocalnetLogsCommandOptions) => Promise<void>
  runLocalnetStart?: (options: LocalnetStartCommandOptions) => Promise<void>
  runLocalnetStatus?: (options: LocalnetStatusCommandOptions) => Promise<void>
  runLocalnetStop?: (options: LocalnetStopCommandOptions) => Promise<void>
  runCreate?: (options: CreateCommandOptions) => Promise<void>
  runDoctor?: (options: DoctorCommandOptions) => Promise<number>
  runTemplatesCheck?: (options: TemplatesCheckCommandOptions) => Promise<void>
  runTemplatesGenerate?: (options: TemplatesGenerateCommandOptions) => Promise<void>
  runTemplatesSync?: (options: TemplatesSyncCommandOptions) => Promise<void>
  runWebshellBuild?: (options: WebshellBuildCommandOptions) => Promise<void>
  runWebshellInit?: (options: WebshellInitCommandOptions) => Promise<void>
}

export function createApp({
  checkForNewerVersion: checkForNewerVersionFn = checkForNewerVersion,
  runDeviceInstall: runDeviceInstallCommand = runDeviceInstall,
  runDeviceList: runDeviceListCommand = runDeviceList,
  runDeviceOpen: runDeviceOpenCommand = runDeviceOpen,
  runEmulatorCreate: runEmulatorCreateCommand = runEmulatorCreate,
  runEmulatorDelete: runEmulatorDeleteCommand = runEmulatorDelete,
  runEmulatorImages: runEmulatorImagesCommand = runEmulatorImages,
  runEmulatorImagesDelete: runEmulatorImagesDeleteCommand = runEmulatorImagesDelete,
  runEmulatorImagesInstall: runEmulatorImagesInstallCommand = runEmulatorImagesInstall,
  runEmulatorList: runEmulatorListCommand = runEmulatorList,
  runEmulatorStart: runEmulatorStartCommand = runEmulatorStart,
  runEmulatorStatus: runEmulatorStatusCommand = runEmulatorStatus,
  runEmulatorStop: runEmulatorStopCommand = runEmulatorStop,
  runEmulatorTune: runEmulatorTuneCommand = runEmulatorTune,
  runLocalnetCheck: runLocalnetCheckCommand = runLocalnetCheck,
  runLocalnetForward: runLocalnetForwardCommand = runLocalnetForward,
  runLocalnetLogs: runLocalnetLogsCommand = runLocalnetLogs,
  runLocalnetStart: runLocalnetStartCommand = runLocalnetStart,
  runLocalnetStatus: runLocalnetStatusCommand = runLocalnetStatus,
  runLocalnetStop: runLocalnetStopCommand = runLocalnetStop,
  runCreate: runCreateCommand = runCreate,
  runDoctor: runDoctorCommand = runDoctor,
  runTemplatesCheck: runTemplatesCheckCommand = runTemplatesCheck,
  runTemplatesGenerate: runTemplatesGenerateCommand = runTemplatesGenerate,
  runTemplatesSync: runTemplatesSyncCommand = runTemplatesSync,
  runWebshellBuild: runWebshellBuildCommand = runWebshellBuild,
  runWebshellInit: runWebshellInitCommand = runWebshellInit,
}: AppOptions = {}) {
  const metadata = readPackageMetadata()
  const app = new Command()

  app
    .enablePositionalOptions()
    .name(metadata.name)
    .description(metadata.description)
    .showHelpAfterError()
    .option('--skip-version-check', 'Skip checking for CLI updates')
    .version(metadata.version)

  // Runs before every subcommand action. checkForNewerVersion resolves undefined instead of
  // throwing or hanging, so an unreachable registry can never break or stall a command.
  app.hook('preAction', async (_thisCommand, actionCommand) => {
    if (isSkipVersionCheckSet(actionCommand)) {
      return
    }

    const update = await checkForNewerVersionFn({ metadata })

    if (update) {
      console.error(formatUpdateWarning(update))
    }
  })

  // Template options (e.g. `--reset-project`) are extracted from the raw arguments before
  // commander parses them: commander drops the `--` separator and reroutes operands once it hits
  // an unknown option, so the leftovers arrive too mangled to parse reliably.
  let createTemplateOptions: string[] = []

  const createCommand = app
    .command('create [projectName]')
    .description('Create a new Solana Mobile project')
    .option('--pm, --package-manager <packageManager>', 'Package manager to use', parsePackageManagerOption)
    .option('-d, --dry-run', 'Dry run')
    .option('-t, --template <templateName>', 'Use a template')
    .option('--list-template-ids', 'List available template ids as JSON array')
    .option('--list-templates', 'List available templates')
    .option('--list-versions', 'Verify your versions of Anchor, AVM, Rust, and Solana')
    .option('--minimal', 'Use the minimal template')
    .option('--skip-git', 'Skip git initialization')
    .option('--skip-init', 'Skip running the init script')
    .option('--skip-install', 'Skip installing dependencies')
    .option('-v, --verbose', 'Verbose output')
    .addHelpText(
      'after',
      '\nOptions declared by the selected template are passed through as boolean long flags, e.g.:\n  $ solana-mobile create my-app --minimal --reset-project',
    )
    .action(async (projectName: string | undefined, options: CreateCommandOptions) => {
      if (options.minimal && options.template) {
        createCommand.error(
          `error: The --minimal flag can't be used in combination with --template. Please specify only one.`,
        )
      }

      await runCreateCommand({
        ...options,
        projectName,
        template: options.template ?? (options.minimal ? MINIMAL_TEMPLATE_NAME : undefined),
        templateOptions: createTemplateOptions,
      })
    })

  const parseCreateCommandOptions = createCommand.parseOptions.bind(createCommand)
  createCommand.parseOptions = (argv: string[]) => {
    try {
      const extracted = extractTemplateOptions(createCommand, argv)
      createTemplateOptions = extracted.templateOptions
      return parseCreateCommandOptions(extracted.args)
    } catch (error) {
      return createCommand.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const deviceCommand = app.command('device').description('Work with connected devices and emulators')

  deviceCommand.action(() => {
    deviceCommand.outputHelp()
  })

  const deviceInstallCommand = deviceCommand
    .command('install [apks...]')
    .description('Install APKs from files, directories, or the APK catalog')
    .option('--all', 'Install on every connected device')
    .option('--device <serial>', 'Target a device serial')
    .option('--downgrade', 'Allow version downgrades (adb install -d)')
    .option('--force', 'Re-download catalog APKs even when cached')
    .option('--grant', 'Grant all runtime permissions (adb install -g)')
    .option('--list', 'List the APKs available in the catalog')
    .option('-v, --verbose', 'Verbose output')
    .action(async (apks: string[] | undefined, options: Omit<DeviceInstallCommandOptions, 'apks'>) => {
      if (options.all && options.device) {
        deviceInstallCommand.error(
          `error: The --all flag can't be used in combination with --device. Please specify only one.`,
        )
      }

      await runDeviceInstallCommand({ ...options, apks: apks ?? [] })
    })

  deviceCommand
    .command('list')
    .description('List connected devices and emulators')
    .option('--json', 'Print a stable JSON report')
    .action(async (options: DeviceListCommandOptions) => {
      await runDeviceListCommand(options)
    })

  deviceCommand
    .command('open [url]')
    .description('Open a URL, port, or deep link on a connected device')
    .option('--device <serial>', 'Target a device serial')
    .option('--no-forward', 'Do not create an adb reverse for localhost URLs')
    .option('-v, --verbose', 'Explain URL and port forwarding decisions')
    .action(async (url: string | undefined, options: Omit<DeviceOpenCommandOptions, 'url'>) => {
      await runDeviceOpenCommand({ ...options, url })
    })

  app
    .command('doctor')
    .description('Check local development dependencies')
    .option('--json', 'Print a stable JSON report')
    .option('--verbose', 'Include resolved paths and diagnostic details')
    .action(async (options: DoctorCommandOptions) => {
      process.exitCode = await runDoctorCommand(options)
    })

  const emulatorCommand = app.command('emulator').alias('emu').description('Manage Android emulators')

  emulatorCommand.action(() => {
    emulatorCommand.outputHelp()
  })

  emulatorCommand
    .command('create [name]')
    .description('Create or update an Android emulator')
    .option('--data-size <size>', 'Data partition size')
    .option('--device <device>', 'Android device profile id')
    .option('--profile <profile>', 'Solana Mobile emulator profile')
    .option('--ram-mb <megabytes>', 'RAM size in MB', parseIntegerOption)
    .option('--sdcard-size <size>', 'SD card size')
    .option('--sdk-root <path>', 'Android SDK root')
    .option('--start', 'Start the emulator after creating it')
    .option('--system-image <package>', 'Android system image package')
    .option('--no-tune', 'Skip applying emulator tweaks after starting')
    .option('-v, --verbose', 'Verbose output')
    .option('--vm-heap-mb <megabytes>', 'VM heap size in MB', parseIntegerOption)
    .action(async (name: string | undefined, options: Omit<EmulatorCreateCommandOptions, 'name'>) => {
      await runEmulatorCreateCommand({ ...options, name })
    })

  emulatorCommand
    .command('delete [names...]')
    .description('Delete Android emulators')
    .option('--sdk-root <path>', 'Android SDK root')
    .action(async (names: string[] | undefined, options: Omit<EmulatorDeleteCommandOptions, 'names'>) => {
      await runEmulatorDeleteCommand({ ...options, names: names ?? [] })
    })

  const emulatorImagesCommand = emulatorCommand.command('images').description('Manage Android system images')

  emulatorImagesCommand.action(() => {
    emulatorImagesCommand.outputHelp()
  })

  emulatorImagesCommand
    .command('delete [systemImages...]')
    .description('Delete installed Android system images')
    .option('--sdk-root <path>', 'Android SDK root')
    .option('-v, --verbose', 'Verbose output')
    .action(
      async (systemImages: string[] | undefined, options: Omit<EmulatorImagesDeleteCommandOptions, 'systemImages'>) => {
        await runEmulatorImagesDeleteCommand({ ...options, systemImages: systemImages ?? [] })
      },
    )

  emulatorImagesCommand
    .command('install [systemImage]')
    .description('Install an Android system image')
    .option('--all', 'Show all available system images')
    .option('--sdk-root <path>', 'Android SDK root')
    .option('-v, --verbose', 'Verbose output')
    .action(
      async (systemImage: string | undefined, options: Omit<EmulatorImagesInstallCommandOptions, 'systemImage'>) => {
        await runEmulatorImagesInstallCommand({ ...options, systemImage })
      },
    )

  emulatorImagesCommand
    .command('list')
    .description('List installed Android system images')
    .option('--sdk-root <path>', 'Android SDK root')
    .action(async (options: EmulatorImagesCommandOptions) => {
      await runEmulatorImagesCommand(options)
    })

  emulatorCommand
    .command('list')
    .description('List installed Android emulators')
    .action(async (options: EmulatorListCommandOptions) => {
      await runEmulatorListCommand(options)
    })

  emulatorCommand
    .command('start [name]')
    .description('Start an Android emulator')
    .option('--sdk-root <path>', 'Android SDK root')
    .option('--no-tune', 'Skip applying emulator tweaks after starting')
    .action(async (name: string | undefined, options: Omit<EmulatorStartCommandOptions, 'name'>) => {
      await runEmulatorStartCommand({ ...options, name })
    })

  emulatorCommand
    .command('status [nameOrSerial]')
    .description('Show Android emulator status')
    .action(async (nameOrSerial: string | undefined) => {
      await runEmulatorStatusCommand({ nameOrSerial })
    })

  emulatorCommand
    .command('stop [nameOrSerial]')
    .description('Stop a running Android emulator')
    .action(async (nameOrSerial: string | undefined) => {
      await runEmulatorStopCommand({ nameOrSerial })
    })

  emulatorCommand
    .command('tune [nameOrSerial]')
    .description('Apply agent-friendly tweaks to a running Android emulator')
    .action(async (nameOrSerial: string | undefined) => {
      await runEmulatorTuneCommand({ nameOrSerial })
    })

  const localnetCommand = withLocalnetTargetOptions(
    app.command('localnet').description('Run a local Solana validator for emulators and devices'),
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

  const templatesCommand = app.command('templates').description('Manage template repositories')

  templatesCommand.action(() => {
    templatesCommand.outputHelp()
  })

  templatesCommand
    .command('check')
    .description('Check generated template artifacts')
    .option('--root <path>', 'Template repository root')
    .action(async (options: TemplatesCheckCommandOptions) => {
      await runTemplatesCheckCommand(options)
    })

  templatesCommand
    .command('generate')
    .description('Generate template artifacts')
    .option('--root <path>', 'Template repository root')
    .action(async (options: TemplatesGenerateCommandOptions) => {
      await runTemplatesGenerateCommand(options)
    })

  templatesCommand
    .command('sync <target>')
    .description('Sync git-tracked templates to another template repository')
    .option('--dry-run', 'Show what would change without writing')
    .option('--force', 'Sync even if the target has uncommitted changes')
    .option('--root <path>', 'Template repository root')
    .action(async (target: string, options: Omit<TemplatesSyncCommandOptions, 'target'>) => {
      await runTemplatesSyncCommand({ ...options, target })
    })

  const webshellCommand = app.command('webshell').description('Wrap a web app in an Android WebView shell')

  webshellCommand.action(() => {
    webshellCommand.outputHelp()
  })

  webshellCommand
    .command('init [directory]')
    .description('Generate an Android WebView project for a web app')
    .option('--app-name <name>', 'Application display name')
    .option('--application-id <id>', 'Android application id (e.g. com.example.app)')
    .option('--force', 'Overwrite an existing directory')
    .option('--keystore-alias <alias>', 'Signing keystore alias')
    .option('--keystore-path <path>', 'Signing keystore path (created when missing)')
    .option('--manifest <path-or-url>', 'Web manifest.json or Bubblewrap twa-manifest.json')
    .option('--url <url>', 'Web app URL to wrap')
    .option('--version-code <number>', 'Android versionCode', parseIntegerOption)
    .option('--version-name <name>', 'Android versionName')
    .action(async (directory: string | undefined, options: Omit<WebshellInitCommandOptions, 'directory'>) => {
      await runWebshellInitCommand({ ...options, directory })
    })

  webshellCommand
    .command('build [directory]')
    .description('Build a release APK from a webshell project')
    .option('--keystore-alias <alias>', 'Signing keystore alias')
    .option('--keystore-path <path>', 'Signing keystore path')
    .option('--stacktrace', 'Pass --stacktrace to Gradle')
    .action(async (directory: string | undefined, options: Omit<WebshellBuildCommandOptions, 'directory'>) => {
      await runWebshellBuildCommand({ ...options, directory })
    })

  // Positional options are enabled, so an option is only accepted where it is declared. The
  // root declaration alone would reject `solana-mobile emulator list --skip-version-check`;
  // every subcommand accepts the flag too, hidden there to keep help output focused.
  for (const command of listCommandsRecursively(app)) {
    command.addOption(new Option('--skip-version-check', 'Skip checking for CLI updates').hideHelp())
  }

  return app
}

function isSkipVersionCheckSet(command: Command): boolean {
  for (let current: Command | null = command; current; current = current.parent) {
    if (current.opts().skipVersionCheck) {
      return true
    }
  }

  return false
}

function* listCommandsRecursively(command: Command): Generator<Command> {
  for (const child of command.commands) {
    yield child
    yield* listCommandsRecursively(child)
  }
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

export async function runApp(argv = process.argv, options: AppOptions = {}) {
  const app = createApp(options)

  if (argv.slice(2).length === 0) {
    app.outputHelp()
    return
  }

  await app.parseAsync(argv)
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

function parseIntegerOption(value: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer, received: ${value}`)
  }

  return parsed
}
