import { Command, Option } from 'commander'
import { readPackageMetadata } from './core/data-access/package-metadata.ts'
import {
  checkForNewerVersion,
  type VersionCheckOptions,
  type VersionCheckResult,
} from './core/data-access/version-check.ts'
import { formatUpdateWarning } from './core/ui/core-ui-update-warning.ts'
import { type CreateCommandDeps, createCreateCommand } from './create/create-feature.ts'
import { createDeviceCommand, type DeviceCommandDeps } from './device/device-feature.ts'
import { createDoctorCommand, type DoctorCommandDeps } from './doctor/doctor-feature.ts'
import { createEmulatorCommand, type EmulatorCommandDeps } from './emulator/emulator-feature.ts'
import { createLocalnetCommand, type LocalnetCommandDeps } from './localnet/localnet-feature.ts'
import { createPlaygroundCommand, type PlaygroundCommandDeps } from './playground/playground-feature.ts'
import { createReleaseCommand, type ReleaseCommandDeps } from './release/release-feature.ts'
import { finishTelemetry, setTelemetryAttributes } from './telemetry/data-access/telemetry-client.ts'
import { type StartTelemetryOptions, startTelemetry } from './telemetry/telemetry-feature-index.ts'
import { createTelemetryCommand, type TelemetryCommandDeps } from './telemetry/telemetry-feature.ts'
import { createTemplatesCommand, type TemplatesCommandDeps } from './templates/templates-feature.ts'
import { createWebshellCommand, type WebshellCommandDeps } from './webshell/webshell-feature.ts'

export type AppOptions = CreateCommandDeps &
  DeviceCommandDeps &
  DoctorCommandDeps &
  EmulatorCommandDeps &
  LocalnetCommandDeps &
  PlaygroundCommandDeps &
  ReleaseCommandDeps &
  TelemetryCommandDeps &
  TemplatesCommandDeps &
  WebshellCommandDeps & {
    checkForNewerVersion?: (options: VersionCheckOptions) => Promise<VersionCheckResult | undefined>
    finishTelemetry?: (error?: unknown) => Promise<void>
    startTelemetry?: (options: StartTelemetryOptions) => Promise<boolean>
  }

export function createApp(appOptions: AppOptions = {}) {
  const {
    checkForNewerVersion: checkForNewerVersionFn = checkForNewerVersion,
    startTelemetry: startTelemetryFn = startTelemetry,
  } = appOptions
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
    if (!isSkipVersionCheckSet(actionCommand)) {
      const update = await checkForNewerVersionFn({ metadata })

      if (update) {
        console.error(formatUpdateWarning(update))
      }
    }

    // `telemetry` manages the setting itself, so it never prompts for or reports on it. Like the
    // version check, startTelemetry resolves instead of throwing.
    const commandPath = getCommandPath(actionCommand)

    if (commandPath.split(' ')[0] !== 'telemetry' && (await startTelemetryFn({ metadata }))) {
      setTelemetryAttributes({ command: commandPath })
    }
  })

  // Registered in alphabetical order, which is the order they are listed in help output. Every
  // feature owns the wiring for its own command and picks the dependencies it needs out of
  // `appOptions`.
  app.addCommand(createCreateCommand(appOptions))
  app.addCommand(createDeviceCommand(appOptions))
  app.addCommand(createDoctorCommand(appOptions))
  app.addCommand(createEmulatorCommand(appOptions))
  app.addCommand(createLocalnetCommand(appOptions))
  app.addCommand(createPlaygroundCommand(appOptions))
  app.addCommand(createReleaseCommand(appOptions))
  app.addCommand(createTelemetryCommand(appOptions))
  app.addCommand(createTemplatesCommand(appOptions))
  app.addCommand(createWebshellCommand(appOptions))

  // Commands added with `addCommand` do not inherit the root's settings the way `command()` copies
  // them, so a feature-owned command would silently lose `enablePositionalOptions` and
  // `showHelpAfterError`. Parents are visited before their children, so each level copies a parent
  // that has already been fixed up.
  //
  // Positional options are enabled, so an option is only accepted where it is declared. The
  // root declaration alone would reject `solana-mobile emulator list --skip-version-check`;
  // every subcommand accepts the flag too, hidden there to keep help output focused.
  for (const command of listCommandsRecursively(app)) {
    command.copyInheritedSettings(command.parent ?? app)
    command.addOption(new Option('--skip-version-check', 'Skip checking for CLI updates').hideHelp())
  }

  return app
}

// The command path without the root, e.g. `emulator start`. Never includes argument values.
function getCommandPath(command: Command): string {
  const names: string[] = []

  for (let current: Command | null = command; current?.parent; current = current.parent) {
    names.unshift(current.name())
  }

  return names.join(' ')
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

export async function runApp(argv = process.argv, options: AppOptions = {}) {
  const app = createApp(options)

  if (argv.slice(2).length === 0) {
    app.outputHelp()
    return
  }

  const { finishTelemetry: finishTelemetryFn = finishTelemetry } = options

  try {
    await app.parseAsync(argv)
  } catch (error) {
    await finishTelemetryFn(error)
    throw error
  }

  await finishTelemetryFn()
}
