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
import { createTemplatesCommand, type TemplatesCommandDeps } from './templates/templates-feature.ts'
import { createWebshellCommand, type WebshellCommandDeps } from './webshell/webshell-feature.ts'

export type AppOptions = CreateCommandDeps &
  DeviceCommandDeps &
  DoctorCommandDeps &
  EmulatorCommandDeps &
  LocalnetCommandDeps &
  PlaygroundCommandDeps &
  TemplatesCommandDeps &
  WebshellCommandDeps & {
    checkForNewerVersion?: (options: VersionCheckOptions) => Promise<VersionCheckResult | undefined>
  }

export function createApp(appOptions: AppOptions = {}) {
  const { checkForNewerVersion: checkForNewerVersionFn = checkForNewerVersion } = appOptions
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

  // Registered in alphabetical order, which is the order they are listed in help output. Every
  // feature owns the wiring for its own command and picks the dependencies it needs out of
  // `appOptions`.
  app.addCommand(createCreateCommand(appOptions))
  app.addCommand(createDeviceCommand(appOptions))
  app.addCommand(createDoctorCommand(appOptions))
  app.addCommand(createEmulatorCommand(appOptions))
  app.addCommand(createLocalnetCommand(appOptions))
  app.addCommand(createPlaygroundCommand(appOptions))
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

  await app.parseAsync(argv)
}
