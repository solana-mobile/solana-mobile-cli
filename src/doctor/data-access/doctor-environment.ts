import { execFile } from 'node:child_process'
import { access, readdir, realpath, statfs } from 'node:fs/promises'
import { homedir, platform, release } from 'node:os'
import { delimiter, join, sep } from 'node:path'

export type CommandResult = { path: string; stderr: string; stdout: string }
export type CommandRunner = (command: string, args?: string[]) => Promise<CommandResult>

export type DoctorEnvironment = {
  architecture: string
  environment: NodeJS.ProcessEnv
  getDiskSpace: (path: string) => Promise<number>
  getHomeDirectory: () => string
  getPlatform: () => NodeJS.Platform
  getRelease: () => string
  listDirectory: (path: string) => Promise<string[]>
  pathExists: (path: string) => Promise<boolean>
  resolvePath: (path: string) => Promise<string>
  runCommand: CommandRunner
}

export const defaultDoctorEnvironment: DoctorEnvironment = {
  architecture: process.arch,
  environment: process.env,
  getDiskSpace: async (path) => {
    const stats = await statfs(path)
    return stats.bavail * stats.bsize
  },
  getHomeDirectory: homedir,
  getPlatform: platform,
  getRelease: release,
  listDirectory: async (path) => readdir(path),
  pathExists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  resolvePath: async (path) => realpath(path),
  runCommand: runExecutable,
}

export function runExecutable(command: string, args: string[] = [], timeout = 5_000): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(command, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolvePromise({ path: command, stderr, stdout })
    })
    child.stdin?.end()
  })
}

export async function findExecutable(
  name: string,
  environment: DoctorEnvironment,
  preferredDirectories: string[] = [],
): Promise<string | undefined> {
  const extensions = environment.getPlatform() === 'win32' ? ['', '.exe', '.bat', '.cmd'] : ['']
  const pathDirectories = (environment.environment.PATH ?? '').split(delimiter).filter(Boolean)
  for (const directory of [...preferredDirectories, ...pathDirectories]) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (await environment.pathExists(candidate)) return candidate
    }
  }
  return undefined
}

export function expandHome(path: string, homeDirectory: string) {
  return path === '~' ? homeDirectory : path.startsWith(`~${sep}`) ? join(homeDirectory, path.slice(2)) : path
}

export function parseVersion(output: string) {
  return output.match(/(?:^|[^\d])(\d+(?:\.\d+){0,3})(?:[^\d]|$)/m)?.[1]
}

export function sortVersions(values: string[]) {
  return [...values].sort((left, right) => compareVersions(left, right))
}

export function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
