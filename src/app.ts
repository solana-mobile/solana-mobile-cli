import { Command, Option } from 'commander'
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
import { createDeviceCommand, type DeviceCommandDeps } from './device/device-feature.ts'
import { createDoctorCommand, type DoctorCommandDeps } from './doctor/doctor-feature.ts'
import { createEmulatorCommand, type EmulatorCommandDeps } from './emulator/emulator-feature.ts'
import { createLocalnetCommand, type LocalnetCommandDeps } from './localnet/localnet-feature.ts'
import { createPlaygroundCommand, type PlaygroundCommandDeps } from './playground/playground-feature.ts'
import { createTemplatesCommand, type TemplatesCommandDeps } from './templates/templates-feature.ts'
import { createWebshellCommand, type WebshellCommandDeps } from './webshell/webshell-feature.ts'

export type AppOptions = DeviceCommandDeps &
  DoctorCommandDeps &
  EmulatorCommandDeps &
  LocalnetCommandDeps &
  PlaygroundCommandDeps &
  TemplatesCommandDeps &
  WebshellCommandDeps & {
    checkForNewerVersion?: (options: VersionCheckOptions) => Promise<VersionCheckResult | undefined>
    runCreate?: (options: CreateCommandOptions) => Promise<void>
  }

export function createApp(appOptions: AppOptions = {}) {
  const {
    checkForNewerVersion: checkForNewerVersionFn = checkForNewerVersion,
    runCreate: runCreateCommand = runCreate,
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

  // Registered in alphabetical order, which is the order they are listed in help output. Every
  // feature owns the wiring for its own command and picks the dependencies it needs out of
  // `appOptions`.
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
