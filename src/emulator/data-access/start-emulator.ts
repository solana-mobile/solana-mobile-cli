import { spawn } from 'node:child_process'
import { resolveAndroidSdkRoot } from '../../core/data-access/android-sdk-root.ts'
import { getEmulatorExecutablePath } from './avd-config.ts'
import type { EmulatorStartCommandOptions, StartEmulatorDependencies } from './emulator-types.ts'
import { listInstalledAvds } from './list-installed-avds.ts'

export async function defaultStartProcess(cmd: [string, ...string[]]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      detached: true,
      stdio: 'ignore',
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function startEmulator(
  { name, sdkRoot = resolveAndroidSdkRoot() }: EmulatorStartCommandOptions,
  {
    getHomeDirectory,
    platform = process.platform,
    readDirectory,
    readTextFile,
    startProcess = defaultStartProcess,
  }: StartEmulatorDependencies = {},
): Promise<void> {
  if (!name) {
    throw new Error('Emulator name is required.')
  }

  const avds = await listInstalledAvds({ getHomeDirectory, readDirectory, readTextFile })

  if (!avds.some((avd) => avd.name === name)) {
    throw new Error(`Unknown emulator: ${name}`)
  }

  await startProcess([getEmulatorExecutablePath(sdkRoot, platform), `@${name}`])
}
