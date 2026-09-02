import { join, resolve } from 'node:path'
import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import type { InteractiveCommandRunner } from '../core/data-access/command-types.ts'
import { runInteractiveExecutable } from '../core/data-access/run-executable.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import {
  resolveWebshellSigningPasswords,
  WEBSHELL_KEY_PASSWORD_ENV,
  WEBSHELL_KEYSTORE_PASSWORD_ENV,
  type WebshellPasswordPrompt,
} from './data-access/keystore.ts'
import { readWebshellProjectConfig, WEBSHELL_PROJECT_CONFIG_FILENAME } from './data-access/project-config.ts'
import type { WebshellBuildCommandOptions } from './data-access/webshell-types.ts'

export interface RunWebshellBuildDependencies {
  cancel?: (message: string) => void
  env?: Partial<Record<string, string>>
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  platform?: NodeJS.Platform
  promptPassword?: WebshellPasswordPrompt
  readProjectConfig?: typeof readWebshellProjectConfig
  resolvePasswords?: typeof resolveWebshellSigningPasswords
  runInteractiveCommand?: InteractiveCommandRunner
}

/**
 * Builds the release APK of a generated webshell project with its own Gradle wrapper. There is
 * deliberately no toolchain preflight: Gradle's stdio is inherited, so a missing JDK or SDK surfaces
 * as Gradle's own error, unfiltered and unwrapped.
 */
export async function runWebshellBuild(
  options: WebshellBuildCommandOptions = {},
  dependencies: RunWebshellBuildDependencies = {},
) {
  const {
    cancel: showCancel = cancel,
    env = process.env,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    platform = process.platform,
    promptPassword,
    readProjectConfig = readWebshellProjectConfig,
    resolvePasswords = resolveWebshellSigningPasswords,
    runInteractiveCommand = runInteractiveExecutable,
  } = dependencies

  try {
    showIntro('solana-mobile webshell build')

    const projectDirectory = resolve(options.directory ?? '.')
    const config = await readProjectConfig(projectDirectory)
    if (config === undefined) {
      throw new Error(
        `${projectDirectory} is not a webshell project: no ${WEBSHELL_PROJECT_CONFIG_FILENAME} found. Run ${formatCommand('webshell init')} first.`,
      )
    }

    // Flags override the saved config. A relative saved path is relative to the project — that is how
    // Bubblewrap writes it — while a relative flag is relative to the caller's cwd.
    const keystorePath = options.keystorePath?.trim()
      ? resolve(options.keystorePath)
      : config.keystorePath
        ? resolve(projectDirectory, config.keystorePath)
        : undefined
    const keystoreAlias = options.keystoreAlias?.trim() || config.keystoreAlias

    // gradlew.bat is not an executable — Windows can only run it through cmd.exe, and cmd.exe parses
    // the command text itself, so page- or manifest-controlled values must carry no metacharacters.
    if (platform === 'win32') {
      for (const [name, value] of Object.entries({ keystoreAlias, keystorePath, projectDirectory })) {
        if (value && /[&|<>^"%\r\n]/.test(value)) {
          throw new Error(`The ${name} contains characters cmd.exe would interpret: ${value}`)
        }
      }
    }
    const command: [string, ...string[]] =
      platform === 'win32'
        ? ['cmd.exe', '/c', join(projectDirectory, 'gradlew.bat'), 'assembleRelease']
        : [join(projectDirectory, 'gradlew'), 'assembleRelease']
    const childEnv: Record<string, string> = {}
    const signed = Boolean(keystorePath && keystoreAlias)

    if (keystorePath && keystoreAlias) {
      const passwords = await resolvePasswords({ env, ...(promptPassword ? { promptPassword } : {}) })
      if (typeof passwords === 'symbol') {
        showCancel('Cancelled')
        process.exitCode = 1
        return
      }

      // Passwords must never appear in argv — only in the child env.
      command.push(`-PSOLANA_MOBILE_KEYSTORE_PATH=${keystorePath}`, `-PSOLANA_MOBILE_KEYSTORE_ALIAS=${keystoreAlias}`)
      childEnv[WEBSHELL_KEYSTORE_PASSWORD_ENV] = passwords.keystorePassword
      childEnv[WEBSHELL_KEY_PASSWORD_ENV] = passwords.keyPassword
    } else {
      log('No signing keystore configured. Gradle will produce an unsigned release APK.')
    }

    if (options.stacktrace) {
      command.push('--stacktrace')
    }

    await runInteractiveCommand(command, { cwd: projectDirectory, env: childEnv })

    const apkPath = join(
      projectDirectory,
      'app',
      'build',
      'outputs',
      'apk',
      'release',
      signed ? 'app-release.apk' : 'app-release-unsigned.apk',
    )
    showOutro(`Built ${apkPath}`)
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
