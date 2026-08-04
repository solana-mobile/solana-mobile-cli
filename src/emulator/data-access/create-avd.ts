import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import {
  createAvdConfigValues,
  getToolPaths,
  parseAvdConfig,
  parseSystemImagePackage,
  resolveCreateOptions,
  resolveEmulatorProfile,
  serializeAvdConfig,
} from './avd-config.ts'
import type {
  CreateAvdDependencies,
  CreateAvdResult,
  EmulatorCreateCommandOptions,
  PathChecker,
} from './emulator-types.ts'
import { listInstalledSystemImages, resolveInstalledSystemImage } from './list-installed-system-images.ts'
import { resolveAndroidCommandLineTool } from './resolve-android-command-line-tool.ts'
import { resolveAndroidSdkRoot } from './resolve-android-sdk-root.ts'

export async function createAvd(
  options: EmulatorCreateCommandOptions,
  {
    getHomeDirectory = homedir,
    pathExists = defaultPathExists(),
    readDirectory,
    readTextFile = defaultReadTextFile,
    runCommand = runExecutable,
    writeTextFile = defaultWriteTextFile,
  }: CreateAvdDependencies = {},
): Promise<CreateAvdResult> {
  const profile = resolveEmulatorProfile(options.profile)
  const name = options.name ?? profile.name
  const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
  const { emulator } = getToolPaths(sdkRoot)
  const homeDirectory = getHomeDirectory()
  const avdDirectory = getAvdDirectoryPath(homeDirectory, name)

  if (await pathExists(avdDirectory)) {
    return {
      created: false,
      emulatorPath: emulator,
      name,
      sdkRoot,
      systemImage: options.systemImage,
    }
  }

  const installedSystemImages = await listInstalledSystemImages(sdkRoot, { pathExists, readDirectory })
  const systemImage = resolveInstalledSystemImage(options.systemImage, installedSystemImages)
  const resolvedOptions = resolveCreateOptions({ ...options, name, sdkRoot }, systemImage)
  const avdmanager = await resolveAndroidCommandLineTool(sdkRoot, 'avdmanager', {
    pathExists,
    readDirectory,
  })
  const { abi } = parseSystemImagePackage(resolvedOptions.systemImage)

  const avdConfigPath = getAvdConfigPath(homeDirectory, resolvedOptions.name)

  await runCommand(
    [
      avdmanager,
      'create',
      'avd',
      '--abi',
      abi,
      '--device',
      resolvedOptions.device,
      '--force',
      '--name',
      resolvedOptions.name,
      '--package',
      resolvedOptions.systemImage,
      '--sdcard',
      resolvedOptions.sdcardSize,
    ],
    { stdin: 'no\n' },
  )

  if (!(await pathExists(avdDirectory))) {
    throw new Error(`Emulator directory does not exist: ${avdDirectory}`)
  }

  const existingConfig = (await pathExists(avdConfigPath)) ? await readTextFile(avdConfigPath) : ''

  await writeTextFile(
    avdConfigPath,
    serializeAvdConfig({
      ...parseAvdConfig(existingConfig),
      ...createAvdConfigValues(resolvedOptions),
    }),
  )

  return {
    created: true,
    emulatorPath: emulator,
    name: resolvedOptions.name,
    sdkRoot: resolvedOptions.sdkRoot,
    systemImage: resolvedOptions.systemImage,
  }
}

export function defaultPathExists(mode: number = constants.F_OK): PathChecker {
  return async (filePath: string) => {
    try {
      await access(filePath, mode)
      return true
    } catch {
      return false
    }
  }
}

export async function defaultWriteTextFile(filePath: string, contents: string) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, contents)
}

function getAvdConfigPath(homeDirectory: string, avdName: string): string {
  return join(getAvdDirectoryPath(homeDirectory, avdName), 'config.ini')
}

export function getAvdDirectoryPath(homeDirectory: string, avdName: string): string {
  return join(homeDirectory, '.android', 'avd', `${avdName}.avd`)
}

async function defaultReadTextFile(filePath: string) {
  return readFile(filePath, 'utf8')
}
