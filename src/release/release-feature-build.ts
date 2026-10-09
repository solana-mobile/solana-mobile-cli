import { access, copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import type { CommandRunner, InteractiveCommandRunner } from '../core/data-access/command-types.ts'
import { runExecutable, runInteractiveExecutable } from '../core/data-access/run-executable.ts'
import {
  type PasswordPrompt,
  resolveSigningPasswords,
  type SigningPasswords,
} from '../core/data-access/signing-passwords.ts'
import { resolveAndroidProjectState } from './data-access/android-project-state.ts'
import { findApkTools, type InspectApkDependencies, inspectApk } from './data-access/inspect-apk.ts'
import { readAndroidGradle } from './data-access/read-android-gradle.ts'
import { findInstalledExpoCli, isRecord, readExpoProject } from './data-access/read-expo-project.ts'
import { buildReleaseReport, getReleaseCheckExitCode } from './data-access/release-checks.ts'
import type { ApkInspection, ReleaseBuildCommandOptions, ReleaseReport } from './data-access/release-types.ts'
import { signApk } from './data-access/sign-apk.ts'
import { formatReleaseReport } from './ui/release-ui-report.ts'

export interface RunReleaseBuildDependencies {
  cancel?: (message: string) => void
  color?: boolean
  copyFile?: (source: string, destination: string) => Promise<void>
  /** Deletes a file, doing nothing when it does not exist. */
  removeFile?: (path: string) => Promise<void>
  env?: Partial<Record<string, string>>
  findApkTools?: typeof findApkTools
  findExpoCli?: (root: string) => Promise<string | undefined>
  inspectApk?: (path: string, dependencies: InspectApkDependencies) => Promise<ApkInspection>
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  pathExists?: (path: string) => Promise<boolean>
  platform?: NodeJS.Platform
  promptPassword?: PasswordPrompt
  runCommand?: CommandRunner
  runInteractiveCommand?: InteractiveCommandRunner
  writeOutput?: (text: string) => void
}

/**
 * Builds a signed release APK of the Expo project in `options.directory` (the cwd by default) and
 * checks it the way `release check --apk` does. The project checks run first and stop the build on a
 * failure; `expo prebuild` regenerates `android/` unless git tracks it; Gradle builds the release
 * variant; `apksigner` signs it with the release keystore when one is given; and the signed APK is
 * inspected before it is reported as built. Resolves the exit code.
 */
export async function runReleaseBuild(
  options: ReleaseBuildCommandOptions = {},
  dependencies: RunReleaseBuildDependencies = {},
): Promise<number> {
  const {
    cancel: showCancel = cancel,
    color = Boolean(process.stdout.isTTY),
    copyFile: copy = copyFile,
    removeFile: remove = (path) => rm(path, { force: true }),
    env = process.env,
    findApkTools: findTools = findApkTools,
    findExpoCli = findInstalledExpoCli,
    inspectApk: inspectApkFile = inspectApk,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    pathExists = exists,
    platform = process.platform,
    promptPassword,
    runCommand = runExecutable,
    runInteractiveCommand = runInteractiveExecutable,
    writeOutput = (text) => process.stdout.write(text),
  } = dependencies
  const printReport = (report: ReleaseReport) => writeOutput(`${formatReleaseReport(report, false, color)}\n`)

  try {
    showIntro('solana-mobile release build')

    const root = resolve(options.directory ?? '.')
    const androidDirectory = join(root, 'android')
    const project = await readExpoProject(root, { findExpoCli, runCommand })
    const android = await resolveAndroidProjectState(root, pathExists, runCommand)
    const gradle = android === 'missing' ? undefined : await readAndroidGradle(androidDirectory)

    // The signing row is left out here: a keystore re-signs whatever Gradle produces, and without one
    // the signing config is checked again after prebuild has had its say.
    const preflight = await buildReleaseReport({ android, gradle, pathExists, project })
    if (preflight.checks.some(({ name, status }) => status === 'fail' && name !== 'Release signing')) {
      printReport(preflight)
      showCancel('Fix the failed checks before building a release.')
      return 1
    }

    // A relative flag is relative to the caller's cwd, like the directory argument.
    const keystorePath = options.keystorePath?.trim() ? resolve(options.keystorePath) : undefined
    const keystoreAlias = options.keystoreAlias?.trim()
    let signing: { apksigner: string; passwords: SigningPasswords } | undefined
    if (keystorePath) {
      if (!keystoreAlias) {
        throw new Error('--keystore-alias is required with --keystore-path.')
      }

      if (!(await pathExists(keystorePath))) {
        throw new Error(`Keystore ${keystorePath} not found.`)
      }

      // Found before the build starts, so a missing tool does not cost a full Gradle run.
      const { apksigner } = await findTools({ environment: { ...process.env, ...env }, pathExists, platform })
      if (!apksigner) {
        throw new Error(
          'apksigner not found. Install Android SDK Build-Tools through Android Studio SDK Manager, or set ANDROID_HOME to the SDK.',
        )
      }

      const passwords = await resolveSigningPasswords({ env, ...(promptPassword ? { promptPassword } : {}) })
      if (typeof passwords === 'symbol') {
        showCancel('Cancelled')
        return 1
      }

      signing = { apksigner, passwords }
    } else if (keystoreAlias) {
      throw new Error('--keystore-path is required with --keystore-alias.')
    }

    if (android !== 'native') {
      const expoCli = await findExpoCli(root)
      if (!expoCli) {
        throw new Error("expo prebuild needs the project's Expo CLI. Install the project's dependencies and run again.")
      }

      log('Generating android/ with expo prebuild')
      // CI keeps prebuild from prompting, and --no-install leaves the project's dependencies alone.
      await runInteractiveCommand(['node', expoCli, 'prebuild', '--platform', 'android', '--no-install'], {
        cwd: root,
        env: { CI: '1' },
      })
    }

    const builtGradle = await readAndroidGradle(androidDirectory)
    if (!signing && builtGradle?.releaseSigning !== 'custom') {
      throw new Error(
        `The release build type is ${builtGradle?.releaseSigning === 'debug' ? 'signed with the debug key' : 'not signed with a release key'}. Pass --keystore-path and --keystore-alias to sign the APK with your release key, or sign release builds through a config plugin.`,
      )
    }

    // Gradle names its output after whether it signed it and leaves the other name alone, so a file from
    // an earlier build is removed first; otherwise it could be picked up as this build's output.
    const outputDirectory = join(androidDirectory, 'app', 'build', 'outputs', 'apk', 'release')
    const signedOutput = join(outputDirectory, 'app-release.apk')
    const unsignedOutput = join(outputDirectory, 'app-release-unsigned.apk')
    await Promise.all([signedOutput, unsignedOutput].map((path) => remove(path)))

    const gradlew = join(androidDirectory, platform === 'win32' ? 'gradlew.bat' : 'gradlew')
    await runInteractiveCommand([gradlew, 'assembleRelease', ...(options.stacktrace ? ['--stacktrace'] : [])], {
      cwd: androidDirectory,
    })

    const built = await findFirst(pathExists, [signedOutput, unsignedOutput])
    if (!built) {
      throw new Error(`Gradle finished, but no release APK was found in ${outputDirectory}.`)
    }

    if (!signing && built === unsignedOutput) {
      throw new Error(
        `Gradle built ${built}: the release signing config produced no signed APK. Check its keystore settings, or pass --keystore-path and --keystore-alias.`,
      )
    }

    const output = options.out?.trim() ? resolve(options.out) : join(outputDirectory, apkFileName(project.config))
    // apksigner opens --out for writing before it has read its input, so the two cannot be one file.
    if (signing && output === built) {
      throw new Error(`--out cannot be Gradle's own output ${built} when signing with a keystore.`)
    }

    if (signing) {
      log(`Signing ${output}`)
      await signApk(
        {
          ...signing,
          input: built,
          keystoreAlias: keystoreAlias as string,
          keystorePath: keystorePath as string,
          output,
        },
        { runCommand },
      )
    } else if (output !== built) {
      await mkdir(dirname(output), { recursive: true })
      await copy(built, output)
    }

    // The same report as `release check --apk`, so the build ends on what the dApp Store will see.
    const apk = await inspectApkFile(output, { pathExists, runCommand })
    const report = await buildReleaseReport({
      android: await resolveAndroidProjectState(root, pathExists, runCommand),
      apk,
      gradle: builtGradle,
      pathExists,
      project,
    })
    printReport(report)

    const exitCode = getReleaseCheckExitCode(report)
    if (exitCode) {
      showCancel(`Built ${output}, but it is not ready for the dApp Store.`)
    } else {
      showOutro(`Built ${output}`)
    }

    return exitCode
  } catch (error) {
    showCancel(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** Names the APK after what the dApp Store identifies it by, such as `com.example.app-1.2.0-3.apk`. */
function apkFileName(config: Record<string, unknown>) {
  const android = isRecord(config.android) ? config.android : {}
  return `${android.package}-${config.version}-${android.versionCode}.apk`
}

async function findFirst(pathExists: (path: string) => Promise<boolean>, paths: string[]) {
  for (const path of paths) {
    if (await pathExists(path)) {
      return path
    }
  }

  return undefined
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
