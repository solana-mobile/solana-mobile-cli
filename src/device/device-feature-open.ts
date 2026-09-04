import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { PromptDependencies } from '../core/ui/core-ui-prompt-types.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { createAdbReverse, listAdbReverses } from '../localnet/data-access/adb-reverse.ts'
import { isUsableDevice } from '../localnet/data-access/list-adb-devices.ts'
import type { AdbDependencies, AdbReverseEntry } from '../localnet/data-access/localnet-types.ts'
import { openUrlOnDevice } from '../localnet/data-access/probe-device-port.ts'
import type { DeviceOpenCommandOptions } from './data-access/device-types.ts'
import { connectedDeviceLabel, listConnectedDevices } from './data-access/list-connected-devices.ts'
import { localhostPort, resolveOpenUrl } from './data-access/resolve-open-url.ts'
import { NO_CONNECTED_DEVICES_MESSAGE } from './ui/device-ui-messages.ts'
import { resolveTargetDevice } from './ui/device-ui-resolve-target-device.ts'
import { selectOpenUrl } from './ui/device-ui-select-open-url.ts'

interface RunDeviceOpenDependencies extends AdbDependencies, PromptDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

export async function runDeviceOpen(
  options: DeviceOpenCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    runCommand = runExecutable,
    runSelect,
    runText,
  }: RunDeviceOpenDependencies = {},
) {
  try {
    showIntro('solana-mobile device open')

    const verboseLog = (message: string) => {
      if (options.verbose) {
        log(message)
      }
    }

    const devices = (await listConnectedDevices({ runCommand })).filter(isUsableDevice)
    const device = await resolveTargetDevice(devices, options.device, { runSelect })

    if (device === undefined) {
      if (devices.length === 0) {
        showNote(formatCommand('emulator start'), NO_CONNECTED_DEVICES_MESSAGE)
        showOutro('Done')
        process.exitCode = 1
      }

      return
    }

    if (!options.device && devices.length === 1) {
      log(`Using device: ${connectedDeviceLabel(device)}`)
    }

    // The reverses double as the suggestion list and as the "already forwarded?" check, so they are
    // fetched once and shared between both.
    let reverses: AdbReverseEntry[] | undefined

    let url: string | undefined

    if (options.url) {
      url = resolveOpenUrl(options.url)

      if (url !== options.url) {
        verboseLog(`Resolved ${options.url} to ${url}`)
      }
    } else {
      reverses = await listAdbReverses(device.serial, { runCommand })
      url = await selectOpenUrl(reverses, { runSelect, runText })
    }

    if (url === undefined) {
      return
    }

    const devicePort = localhostPort(url)

    if (options.forward === false) {
      verboseLog('Not forwarding: disabled with --no-forward')
    } else if (devicePort === undefined) {
      verboseLog(`Not forwarding: ${url} does not name an explicit localhost port`)
    } else {
      reverses ??= await listAdbReverses(device.serial, { runCommand })

      // An existing reverse is kept even when it points at a different host port: it may be owned by
      // localnet, whose `--port` deliberately moves the host side while the device keeps its port.
      const existing = reverses.find((reverse) => reverse.devicePort === devicePort)

      if (existing) {
        verboseLog(`Keeping the existing reverse: device port ${existing.devicePort} to host port ${existing.hostPort}`)
      } else {
        await createAdbReverse(device.serial, { devicePort, hostPort: devicePort }, { runCommand })
        log(`Forwarded device port ${devicePort} to host port ${devicePort}`)
      }
    }

    await openUrlOnDevice(device.serial, url, { runCommand })

    log(`Opened ${url} on ${connectedDeviceLabel(device)}`)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
