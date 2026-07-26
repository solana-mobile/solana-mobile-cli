import { Command, InvalidArgumentError } from 'commander'
import { readPackageMetadata } from './core/data-access/package-metadata.ts'
import { type CreateCommandOptions, parsePackageManagerOption, runCreate } from './create/create-feature-index.ts'
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
  runEmulatorCreate,
  runEmulatorDelete,
  runEmulatorImages,
  runEmulatorImagesDelete,
  runEmulatorImagesInstall,
  runEmulatorList,
  runEmulatorStart,
  runEmulatorStatus,
  runEmulatorStop,
} from './emulator/emulator-feature-index.ts'

export type AppOptions = {
  runEmulatorCreate?: (options: EmulatorCreateCommandOptions) => Promise<void>
  runEmulatorDelete?: (options: EmulatorDeleteCommandOptions) => Promise<void>
  runEmulatorImages?: (options: EmulatorImagesCommandOptions) => Promise<void>
  runEmulatorImagesDelete?: (options: EmulatorImagesDeleteCommandOptions) => Promise<void>
  runEmulatorImagesInstall?: (options: EmulatorImagesInstallCommandOptions) => Promise<void>
  runEmulatorList?: (options: EmulatorListCommandOptions) => Promise<void>
  runEmulatorStart?: (options: EmulatorStartCommandOptions) => Promise<void>
  runEmulatorStatus?: (options: EmulatorStatusCommandOptions) => Promise<void>
  runEmulatorStop?: (options: EmulatorStopCommandOptions) => Promise<void>
  runCreate?: (options: CreateCommandOptions) => Promise<void>
  runDoctor?: (options: DoctorCommandOptions) => Promise<number>
}

export function createApp({
  runEmulatorCreate: runEmulatorCreateCommand = runEmulatorCreate,
  runEmulatorDelete: runEmulatorDeleteCommand = runEmulatorDelete,
  runEmulatorImages: runEmulatorImagesCommand = runEmulatorImages,
  runEmulatorImagesDelete: runEmulatorImagesDeleteCommand = runEmulatorImagesDelete,
  runEmulatorImagesInstall: runEmulatorImagesInstallCommand = runEmulatorImagesInstall,
  runEmulatorList: runEmulatorListCommand = runEmulatorList,
  runEmulatorStart: runEmulatorStartCommand = runEmulatorStart,
  runEmulatorStatus: runEmulatorStatusCommand = runEmulatorStatus,
  runEmulatorStop: runEmulatorStopCommand = runEmulatorStop,
  runCreate: runCreateCommand = runCreate,
  runDoctor: runDoctorCommand = runDoctor,
}: AppOptions = {}) {
  const metadata = readPackageMetadata()
  const app = new Command()

  app
    .enablePositionalOptions()
    .name(metadata.name)
    .description(metadata.description)
    .showHelpAfterError()
    .version(metadata.version)

  app
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
    .action(async (projectName: string | undefined, options: CreateCommandOptions) => {
      await runCreateCommand({
        ...options,
        projectName,
        template: options.template ?? (options.minimal ? 'kit-expo-minimal' : undefined),
      })
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

  return app
}

export async function runApp(argv = process.argv, options: AppOptions = {}) {
  const app = createApp(options)

  if (argv.slice(2).length === 0) {
    app.outputHelp()
    return
  }

  await app.parseAsync(argv)
}

function parseIntegerOption(value: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer, received: ${value}`)
  }

  return parsed
}
