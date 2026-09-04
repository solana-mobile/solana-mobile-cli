import { basename } from 'node:path'
import { cancel, log as clackLog, intro, note, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import type { PromptDependencies } from '../core/ui/core-ui-prompt-types.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import { isUsableDevice } from '../localnet/data-access/list-adb-devices.ts'
import type { AdbDependencies } from '../localnet/data-access/localnet-types.ts'
import { APK_CATALOG, findApkCatalogEntry, githubReleaseDownloadUrl } from './data-access/apk-catalog.ts'
import type { DeviceInstallCommandOptions } from './data-access/device-types.ts'
import { type DownloadApkDependencies, ensureApkDownloaded } from './data-access/download-apk.ts'
import { installApk } from './data-access/install-apk.ts'
import { connectedDeviceLabel, listConnectedDevices } from './data-access/list-connected-devices.ts'
import {
  type ApkInstallItem,
  type ResolveApkArgsDependencies,
  resolveApkArgs,
} from './data-access/resolve-apk-installs.ts'
import { NO_CONNECTED_DEVICES_MESSAGE } from './ui/device-ui-messages.ts'
import { resolveTargetDevices } from './ui/device-ui-resolve-target-device.ts'
import { selectCatalogApkNames } from './ui/device-ui-select-catalog-apks.ts'

interface RunDeviceInstallDependencies
  extends AdbDependencies,
    DownloadApkDependencies,
    PromptDependencies,
    ResolveApkArgsDependencies {
  cancel?: (message: string) => void
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  note?: (message: string, title?: string) => void
  outro?: (message: string) => void
}

export async function runDeviceInstall(
  options: DeviceInstallCommandOptions = {},
  {
    cancel: showCancel = cancel,
    downloadFile,
    fileExists,
    formatCommand = formatCliCommand,
    getCacheDirectory,
    intro: showIntro = intro,
    listDirectory,
    log = clackLog.message,
    note: showNote = note,
    outro: showOutro = outro,
    pathKind,
    runCommand = runExecutable,
    runMultiselect,
    runSelect,
  }: RunDeviceInstallDependencies = {},
) {
  try {
    showIntro('solana-mobile device install')

    if (options.list) {
      showNote(
        APK_CATALOG.map(({ description, name, source }) => `${name} — ${description} (${source.tag})`).join('\n'),
        'APK catalog',
      )
      showOutro('Done')
      return
    }

    const verboseLog = (message: string) => {
      if (options.verbose) {
        log(message)
      }
    }

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

    const items = await resolveInstallItems(options.apks ?? [], { listDirectory, pathKind, runMultiselect })

    if (items === undefined) {
      return
    }

    if (items.length === 0) {
      showOutro('Done')
      return
    }

    // Catalog entries resolve to cached local paths before any install starts, so a failed download
    // never leaves a device half-provisioned.
    const apks: Array<{ label: string; path: string }> = []

    for (const item of items) {
      if (item.kind === 'local') {
        apks.push({ label: basename(item.path), path: item.path })
        continue
      }

      verboseLog(`Download URL: ${githubReleaseDownloadUrl(item.entry.source)}`)

      const { downloaded, path } = await ensureApkDownloaded(
        item.entry,
        { force: options.force },
        { downloadFile, fileExists, getCacheDirectory },
      )

      log(`${downloaded ? 'Downloaded' : 'Using cached'} ${item.entry.name} (${item.entry.source.tag})`)
      verboseLog(`Cached at: ${path}`)
      apks.push({ label: item.entry.name, path })
    }

    const failures: string[] = []
    let installed = 0

    for (const target of targets) {
      const suffix = targets.length > 1 ? ` on ${connectedDeviceLabel(target)}` : ''

      for (const apk of apks) {
        try {
          await installApk(
            target.serial,
            apk.path,
            { downgrade: options.downgrade, grant: options.grant },
            { runCommand },
          )
          log(`Installed ${apk.label}${suffix}`)
          installed += 1
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)

          failures.push(`${apk.label}${suffix}: ${reason}`)
          log(`Failed to install ${apk.label}${suffix}: ${reason}`)
        }
      }
    }

    if (failures.length === 0) {
      showOutro(`Installed ${installed} APK${installed === 1 ? '' : 's'}`)
      return
    }

    showNote(failures.join('\n'), `${installed} installed, ${failures.length} failed`)
    showOutro(`${installed} installed, ${failures.length} failed`)
    process.exitCode = 1
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

/** `undefined` means the catalog picker was cancelled; an empty array means nothing was selected. */
async function resolveInstallItems(
  args: readonly string[],
  { listDirectory, pathKind, runMultiselect }: PromptDependencies & ResolveApkArgsDependencies,
): Promise<ApkInstallItem[] | undefined> {
  if (args.length > 0) {
    return resolveApkArgs(args, { listDirectory, pathKind })
  }

  const names = await selectCatalogApkNames(APK_CATALOG, runMultiselect)

  if (names === undefined) {
    return undefined
  }

  return names.flatMap((name) => {
    const entry = findApkCatalogEntry(name)

    return entry ? [{ entry, kind: 'catalog' as const }] : []
  })
}
