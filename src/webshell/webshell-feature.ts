import { Command } from 'commander'
import { parseIntegerOption } from '../core/ui/core-ui-command-options.ts'
import type { WebshellBuildCommandOptions, WebshellInitCommandOptions } from './data-access/webshell-types.ts'
import { runWebshellBuild } from './webshell-feature-build.ts'
import { runWebshellInit } from './webshell-feature-init.ts'

export type WebshellCommandDeps = {
  runWebshellBuild?: (options: WebshellBuildCommandOptions) => Promise<void>
  runWebshellInit?: (options: WebshellInitCommandOptions) => Promise<void>
}

export function createWebshellCommand({
  runWebshellBuild: runWebshellBuildCommand = runWebshellBuild,
  runWebshellInit: runWebshellInitCommand = runWebshellInit,
}: WebshellCommandDeps = {}): Command {
  const webshellCommand = new Command('webshell').description('Wrap a web app in an Android WebView shell')

  webshellCommand.action(() => {
    webshellCommand.outputHelp()
  })

  webshellCommand
    .command('init [directory]')
    .description('Generate an Android WebView project for a web app')
    .option('--app-name <name>', 'Application display name')
    .option('--application-id <id>', 'Android application id (e.g. com.example.app)')
    .option('--force', 'Overwrite an existing directory')
    .option('--keystore-alias <alias>', 'Signing keystore alias')
    .option('--keystore-path <path>', 'Signing keystore path (created when missing)')
    .option('--manifest <path-or-url>', 'Web manifest.json or Bubblewrap twa-manifest.json')
    .option('--url <url>', 'Web app URL to wrap')
    .option('--version-code <number>', 'Android versionCode', parseIntegerOption)
    .option('--version-name <name>', 'Android versionName')
    .action(async (directory: string | undefined, options: Omit<WebshellInitCommandOptions, 'directory'>) => {
      await runWebshellInitCommand({ ...options, directory })
    })

  webshellCommand
    .command('build [directory]')
    .description('Build a release APK from a webshell project')
    .option('--keystore-alias <alias>', 'Signing keystore alias')
    .option('--keystore-path <path>', 'Signing keystore path')
    .option('--stacktrace', 'Pass --stacktrace to Gradle')
    .action(async (directory: string | undefined, options: Omit<WebshellBuildCommandOptions, 'directory'>) => {
      await runWebshellBuildCommand({ ...options, directory })
    })

  return webshellCommand
}
