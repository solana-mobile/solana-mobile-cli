import { delimiter, join } from 'node:path'

export interface FindExecutableOptions {
  environment?: NodeJS.ProcessEnv
  pathExists: (filePath: string) => Promise<boolean>
  platform?: NodeJS.Platform
  /** Searched before PATH, so an SDK-owned tool wins over a stray global install. */
  preferredDirectories?: readonly string[]
}

/**
 * File names a tool can be launched under. Windows only runs files with an executable extension, ordered here like
 * the default PATHEXT; an extensionless `avdmanager` beside `avdmanager.bat` is the POSIX shell script and would fail
 * to spawn, so it is deliberately not a candidate there.
 */
export function executableFileNames(name: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['.exe', '.bat', '.cmd'].map((extension) => `${name}${extension}`) : [name]
}

export async function findExecutable(
  name: string,
  {
    environment = process.env,
    pathExists,
    platform = process.platform,
    preferredDirectories = [],
  }: FindExecutableOptions,
): Promise<string | undefined> {
  const pathDirectories = (environment.PATH ?? '').split(delimiter).filter(Boolean)
  const fileNames = executableFileNames(name, platform)

  for (const directory of [...preferredDirectories, ...pathDirectories]) {
    for (const fileName of fileNames) {
      const candidate = join(directory, fileName)

      if (await pathExists(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}
