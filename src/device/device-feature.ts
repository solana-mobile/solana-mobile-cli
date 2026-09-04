import { Command } from 'commander'
import type {
  DeviceInstallCommandOptions,
  DeviceListCommandOptions,
  DeviceOpenCommandOptions,
  DeviceTuneCommandOptions,
} from './data-access/device-types.ts'
import { runDeviceInstall } from './device-feature-install.ts'
import { runDeviceList } from './device-feature-list.ts'
import { runDeviceOpen } from './device-feature-open.ts'
import { runDeviceTune } from './device-feature-tune.ts'

export type DeviceCommandDeps = {
  runDeviceInstall?: (options: DeviceInstallCommandOptions) => Promise<void>
  runDeviceList?: (options: DeviceListCommandOptions) => Promise<void>
  runDeviceOpen?: (options: DeviceOpenCommandOptions) => Promise<void>
  runDeviceTune?: (options: DeviceTuneCommandOptions) => Promise<void>
}

export function createDeviceCommand({
  runDeviceInstall: runDeviceInstallCommand = runDeviceInstall,
  runDeviceList: runDeviceListCommand = runDeviceList,
  runDeviceOpen: runDeviceOpenCommand = runDeviceOpen,
  runDeviceTune: runDeviceTuneCommand = runDeviceTune,
}: DeviceCommandDeps = {}): Command {
  const deviceCommand = new Command('device').description('Work with connected devices and emulators')

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

  const deviceTuneCommand = deviceCommand
    .command('tune')
    .description('Apply agent-friendly tweaks to a connected device or emulator')
    .option('--all', 'Tune every connected device')
    .option('--device <serial>', 'Target a device serial')
    .option('-y, --yes', 'Apply every tweak without prompting')
    .action(async (options: DeviceTuneCommandOptions) => {
      if (options.all && options.device) {
        deviceTuneCommand.error(
          `error: The --all flag can't be used in combination with --device. Please specify only one.`,
        )
      }

      await runDeviceTuneCommand(options)
    })

  return deviceCommand
}
