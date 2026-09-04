import type { CommandRunner } from '../../core/data-access/command-types.ts'
import type { AppliedDeviceTweaks } from '../../device/data-access/device-types.ts'
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
  tune?: boolean
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
  verbose?: boolean
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
  tune?: boolean
}

export interface EmulatorStatusCommandOptions {
  nameOrSerial?: string
}

export interface EmulatorStopCommandOptions {
  nameOrSerial?: string
}

export interface EmulatorTuneCommandOptions {
  nameOrSerial?: string
  /** Skip the tweak picker and apply every tweak, for unattended runs. */
  yes?: boolean
}

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
  getHomeDirectory?: HomeDirectoryResolver
  pathExists?: PathChecker
  runCommand?: CommandRunner
}

export interface DeleteInstalledAvdsResult {
  deleted: string[]
  /** `<name>: <reason>` lines for AVDs `avdmanager` refused to delete. */
  failures: string[]
  notInstalled: string[]
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

export interface RunningEmulator {
  name: string
  serial: string
}

export interface StartEmulatorDependencies extends ListInstalledAvdsDependencies {
  startProcess?: ProcessStarter
}

export interface StopEmulatorDependencies extends ListRunningEmulatorsDependencies {}

export interface TuneEmulatorDependencies extends ListRunningEmulatorsDependencies {}

export interface TuneEmulatorResult extends AppliedDeviceTweaks {
  emulator: RunningEmulator
}

export interface WaitForEmulatorBootDependencies extends ListRunningEmulatorsDependencies {
  pollIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
  timeoutMs?: number
}
