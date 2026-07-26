import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseAvdConfig, parseSystemImagePackage } from './avd-config.ts'
import type { DirectoryReader, InstalledAvd, ListInstalledAvdsDependencies } from './emulator-types.ts'

export async function defaultReadDirectory(directoryPath: string) {
  return readdir(directoryPath, { withFileTypes: true })
}

export async function defaultReadTextFile(filePath: string) {
  return readFile(filePath, 'utf8')
}

export async function listInstalledAvds({
  getHomeDirectory = homedir,
  readDirectory = defaultReadDirectory,
  readTextFile = defaultReadTextFile,
}: ListInstalledAvdsDependencies = {}): Promise<InstalledAvd[]> {
  const avdRootDirectory = join(getHomeDirectory(), '.android', 'avd')
  const avdEntryNames = await listEntryNames(avdRootDirectory, readDirectory)
  const registeredAvdNames = new Set(
    avdEntryNames.filter((name) => name.endsWith('.ini')).map((name) => name.slice(0, -'.ini'.length)),
  )
  const avdDirectoryNames = avdEntryNames.filter(
    (name) => name.endsWith('.avd') && registeredAvdNames.has(name.slice(0, -'.avd'.length)),
  )
  const avds = await Promise.all(
    avdDirectoryNames.map(async (directoryName) => {
      const configPath = join(avdRootDirectory, directoryName, 'config.ini')
      const name = directoryName.slice(0, -'.avd'.length)
      let configValues: Record<string, string> = {}

      try {
        configValues = parseAvdConfig(await readTextFile(configPath))
      } catch {
        configValues = {}
      }

      return {
        device: configValues['hw.device.name'],
        name,
        systemImage: parseAvdSystemImage(configValues['image.sysdir.1']),
        target: configValues.target,
      }
    }),
  )

  return avds.sort((left, right) => left.name.localeCompare(right.name))
}

function parseAvdSystemImage(systemImageDirectory: string | undefined): string | undefined {
  if (!systemImageDirectory) {
    return undefined
  }

  const systemImage = systemImageDirectory.replace(/\/+$/, '').replaceAll('/', ';')

  try {
    parseSystemImagePackage(systemImage)
    return systemImage
  } catch {
    return undefined
  }
}

async function listEntryNames(directoryPath: string, readDirectory: DirectoryReader): Promise<string[]> {
  try {
    return (await readDirectory(directoryPath))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}
