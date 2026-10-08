import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CommandRunner } from '../core/data-access/command-types.ts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { type InspectApkDependencies, inspectApk } from './data-access/inspect-apk.ts'
import { readAndroidGradle } from './data-access/read-android-gradle.ts'
import { type ReadExpoProjectDependencies, readExpoProject } from './data-access/read-expo-project.ts'
import { buildReleaseReport, getReleaseCheckExitCode } from './data-access/release-checks.ts'
import type {
  AndroidProjectState,
  ApkInspection,
  ReleaseCheckCommandOptions,
  ReleaseReport,
} from './data-access/release-types.ts'
import { formatReleaseReport } from './ui/release-ui-report.ts'

export interface RunReleaseCheckDependencies extends ReadExpoProjectDependencies {
  color?: boolean
  inspectApk?: (path: string, dependencies: InspectApkDependencies) => Promise<ApkInspection>
  pathExists?: (path: string) => Promise<boolean>
  runCommand?: CommandRunner
  writeError?: (text: string) => void
  writeOutput?: (text: string) => void
}

/**
 * Checks that the Expo project in `options.directory` (the cwd by default) is ready to be built as a
 * Solana dApp Store release. Nothing in the project is written, installed or generated. Resolves the
 * exit code: 1 when any check fails or the directory is not an Expo project.
 */
export async function runReleaseCheck(
  options: ReleaseCheckCommandOptions = {},
  dependencies: RunReleaseCheckDependencies = {},
): Promise<number> {
  const {
    color = Boolean(process.stdout.isTTY),
    inspectApk: inspectApkFile = inspectApk,
    pathExists = exists,
    runCommand = runExecutable,
    writeError = (text) => process.stderr.write(text),
    writeOutput = (text) => process.stdout.write(text),
  } = dependencies

  let report: ReleaseReport
  try {
    const root = resolve(options.directory ?? '.')
    const project = await readExpoProject(root, { ...dependencies, runCommand })
    const androidDirectory = join(root, 'android')
    const android = await resolveAndroidProjectState(root, pathExists, runCommand)
    const gradle = android === 'missing' ? undefined : await readAndroidGradle(androidDirectory)
    // A relative --apk is relative to the caller's cwd, like the directory argument.
    const apk = options.apk ? await inspectApkFile(resolve(options.apk), { pathExists, runCommand }) : undefined
    report = await buildReleaseReport({ android, apk, gradle, pathExists, project })
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : error}\n`)
    return 1
  }

  writeOutput(
    options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReleaseReport(report, options.verbose, color)}\n`,
  )
  return getReleaseCheckExitCode(report)
}

/**
 * An `android/` directory that git ignores is a continuous native generation project, rebuilt by
 * prebuild from the app config. Outside a git repository `git check-ignore` fails, which counts as
 * not ignored, so the directory is treated as a native project.
 */
async function resolveAndroidProjectState(
  root: string,
  pathExists: (path: string) => Promise<boolean>,
  runCommand: CommandRunner,
): Promise<AndroidProjectState> {
  if (!(await pathExists(join(root, 'android')))) {
    return 'missing'
  }

  try {
    await runCommand(['git', '-C', root, 'check-ignore', '--quiet', 'android'])
    return 'generated'
  } catch {
    return 'native'
  }
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
