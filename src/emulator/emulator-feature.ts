import { Command } from 'commander'
import { parseIntegerOption } from '../core/ui/core-ui-command-options.ts'
import type {
  EmulatorCreateCommandOptions,
  EmulatorDeleteCommandOptions,
  EmulatorImagesCommandOptions,
  EmulatorImagesDeleteCommandOptions,
  EmulatorImagesInstallCommandOptions,
  EmulatorListCommandOptions,
  EmulatorStartCommandOptions,
  EmulatorStatusCommandOptions,
  EmulatorStopCommandOptions,
  EmulatorTuneCommandOptions,
} from './data-access/emulator-types.ts'
import { runEmulatorCreate } from './emulator-feature-create.ts'
import { runEmulatorDelete } from './emulator-feature-delete.ts'
import { runEmulatorImages, runEmulatorImagesDelete, runEmulatorImagesInstall } from './emulator-feature-images.ts'
import { runEmulatorList } from './emulator-feature-list.ts'
import { runEmulatorStart } from './emulator-feature-start.ts'
import { runEmulatorStatus } from './emulator-feature-status.ts'
import { runEmulatorStop } from './emulator-feature-stop.ts'
import { runEmulatorTune } from './emulator-feature-tune.ts'

export type EmulatorCommandDeps = {
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
}

export function createEmulatorCommand({
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
}: EmulatorCommandDeps = {}): Command {
  const emulatorCommand = new Command('emulator').alias('emu').description('Manage Android emulators')

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
    .option('--tune', 'Apply emulator tweaks after starting (requires --start)')
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
    .option('--tune', 'Apply emulator tweaks after starting')
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
    .option('-y, --yes', 'Apply every tweak without prompting')
    .action(async (nameOrSerial: string | undefined, options: Omit<EmulatorTuneCommandOptions, 'nameOrSerial'>) => {
      await runEmulatorTuneCommand({ ...options, nameOrSerial })
    })

  return emulatorCommand
}
