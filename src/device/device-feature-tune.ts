import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type { PromptDependencies } from '../emulator/ui/emulator-ui-prompt-types.ts'
import { isUsableDevice } from '../localnet/data-access/list-adb-devices.ts'
import type { AdbDependencies } from '../localnet/data-access/localnet-types.ts'
import type { DeviceTuneCommandOptions } from './data-access/device-types.ts'
import { connectedDeviceLabel, listConnectedDevices } from './data-access/list-connected-devices.ts'
import { applyDeviceTweaks } from './data-access/tune-device.ts'
import { formatAppliedTweaks } from './ui/device-ui-format-applied-tweaks.ts'
import { NO_CONNECTED_DEVICES_MESSAGE, NO_TWEAKS_SELECTED_MESSAGE } from './ui/device-ui-messages.ts'
import { resolveTargetDevices } from './ui/device-ui-resolve-target-device.ts'
import { resolveDeviceTweaks } from './ui/device-ui-select-device-tweaks.ts'

interface RunDeviceTuneDependencies extends AdbDependencies, PromptDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

export async function runDeviceTune(
  options: DeviceTuneCommandOptions = {},
  {
    cancel: showCancel = cancel,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    runCommand = runExecutable,
    runMultiselect,
    runSelect,
  }: RunDeviceTuneDependencies = {},
) {
  try {
    showIntro('solana-mobile device tune')

    const devices = (await listConnectedDevices({ runCommand })).filter(isUsableDevice)
    const targets = await resolveTargetDevices(devices, options, { runSelect })

    const firstTarget = targets?.[0]

    if (targets === undefined || firstTarget === undefined) {
      if (devices.length === 0) {
        showNote(formatCommand('emulator start'), NO_CONNECTED_DEVICES_MESSAGE)
        showOutro('Done')
        process.exitCode = 1
      }

      return
    }

    if (!options.all && !options.device && devices.length === 1) {
      log(`Using device: ${connectedDeviceLabel(firstTarget)}`)
    }

    // Selected once and applied to every target, so tuning several devices stays one decision.
    const tweaks = await resolveDeviceTweaks(options, runMultiselect)

    if (tweaks === undefined) {
      return
    }

    if (tweaks.length === 0) {
      log(NO_TWEAKS_SELECTED_MESSAGE)
      showOutro('Done')
      return
    }

    for (const target of targets) {
      log(
        formatAppliedTweaks(
          connectedDeviceLabel(target),
          await applyDeviceTweaks(target.serial, { tweaks }, { runCommand }),
        ),
      )
    }

    showOutro(`Tuned ${targets.length} device${targets.length === 1 ? '' : 's'}`)
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
