import { join } from 'node:path'
import { executableFileNames } from '../../core/data-access/executable-lookup.ts'
import type { DirectoryReader, PathChecker } from './emulator-types.ts'
import { defaultReadDirectory } from './list-installed-avds.ts'

interface ResolveAndroidCommandLineToolDependencies {
  pathExists: PathChecker
  platform?: NodeJS.Platform
  readDirectory?: DirectoryReader
}

/** Finds a cmdline-tools binary such as `avdmanager`, preferring `latest` and, on Windows, its `.bat` launcher. */
export async function resolveAndroidCommandLineTool(
  sdkRoot: string,
  tool: string,
  {
    pathExists,
    platform = process.platform,
    readDirectory = defaultReadDirectory,
  }: ResolveAndroidCommandLineToolDependencies,
): Promise<string> {
  const commandLineToolsRoot = join(sdkRoot, 'cmdline-tools')
  const directories = await listDirectoryNames(commandLineToolsRoot, readDirectory)
  const fileNames = executableFileNames(tool, platform)

  for (const directory of directories) {
    for (const fileName of fileNames) {
      const candidate = join(commandLineToolsRoot, directory, 'bin', fileName)

      if (await pathExists(candidate)) {
        return candidate
      }
    }
  }

  throw new Error(
    `${tool} not found under ${commandLineToolsRoot}. Install Android SDK Command-line Tools through Android Studio SDK Manager.`,
  )
}

async function listDirectoryNames(directoryPath: string, readDirectory: DirectoryReader): Promise<string[]> {
  try {
    return (await readDirectory(directoryPath))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => {
        if (left === 'latest') return -1
        if (right === 'latest') return 1
        return right.localeCompare(left, 'en', { numeric: true })
      })
  } catch {
    return []
  }
}
