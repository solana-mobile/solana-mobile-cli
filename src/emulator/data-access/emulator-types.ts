export interface DirectoryEntry {
  isDirectory(): boolean
  name: string
}

export interface EmulatorCreateCommandOptions {
  dataSize?: string
  device?: string
  name?: string
  profile?: string
  ramMb?: number
  sdcardSize?: string
  sdkRoot?: string
  start?: boolean
  systemImage?: string
  verbose?: boolean
  vmHeapMb?: number
}

export interface EmulatorDeleteCommandOptions {
  names?: string[]
  sdkRoot?: string
}

export interface EmulatorImagesCommandOptions {
  sdkRoot?: string
}

export interface EmulatorImagesDeleteCommandOptions {
  sdkRoot?: string
  systemImages?: string[]
}

export interface EmulatorImagesInstallCommandOptions {
  all?: boolean
  sdkRoot?: string
  systemImage?: string
  verbose?: boolean
}

export type EmulatorListCommandOptions = Record<string, never>

export interface EmulatorStartCommandOptions {
  name?: string
  sdkRoot?: string
}

export interface EmulatorStatusCommandOptions {
  nameOrSerial?: string
}

export interface EmulatorStopCommandOptions {
  nameOrSerial?: string
}

export type CommandRunner = (cmd: [string, ...string[]], options?: RunCommandOptions) => Promise<string>

export interface CreateAvdDependencies {
  getHomeDirectory?: HomeDirectoryResolver
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
  readTextFile?: FileReader
  runCommand?: CommandRunner
  writeTextFile?: FileWriter
}

export interface CreateAvdResult {
  created: boolean
  emulatorPath: string
  name: string
  sdkRoot: string
  systemImage?: string
}

export interface DeleteInstalledAvdsDependencies {
  runCommand?: CommandRunner
}

export type DirectoryReader = (directoryPath: string) => Promise<readonly DirectoryEntry[]>

export interface EmulatorAdbDevice {
  serial: string
  state: string
}

export interface EmulatorStatus {
  booted: 'no' | 'unknown' | 'yes'
  device?: string
  name: string
  serial?: string
  state: string
  target?: string
}

export type FileReader = (filePath: string) => Promise<string>

export type FileWriter = (filePath: string, contents: string) => Promise<void>

export type HomeDirectoryResolver = () => string

export type InteractiveCommandRunner = (cmd: [string, ...string[]]) => Promise<void>

export interface InstalledAvd {
  device?: string
  name: string
  systemImage?: string
  target?: string
}

export interface ListEmulatorStatusesDependencies
  extends ListInstalledAvdsDependencies,
    ListRunningEmulatorsDependencies {}

export interface ListInstalledAvdsDependencies {
  getHomeDirectory?: HomeDirectoryResolver
  readDirectory?: DirectoryReader
  readTextFile?: FileReader
}

export interface ListRunningEmulatorsDependencies {
  runCommand?: CommandRunner
}

export interface ParsedSystemImagePackage {
  abi: string
  platform: string
  tagId: string
}

export type PathChecker = (filePath: string) => Promise<boolean>

export type ProcessStarter = (cmd: [string, ...string[]]) => Promise<void>

export interface ResolvedCreateOptions {
  dataSize: string
  device: string
  name: string
  ramMb: number
  sdkRoot: string
  sdcardSize: string
  systemImage: string
  vmHeapMb: number
}

export interface RunCommandOptions {
  stdin?: string
}

export interface RunningEmulator {
  name: string
  serial: string
}

export interface StartEmulatorDependencies extends ListInstalledAvdsDependencies {
  startProcess?: ProcessStarter
}

export interface StopEmulatorDependencies extends ListRunningEmulatorsDependencies {}
