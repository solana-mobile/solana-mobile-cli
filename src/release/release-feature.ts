import { Command } from 'commander'
import type { ReleaseBuildCommandOptions, ReleaseCheckCommandOptions } from './data-access/release-types.ts'
import { runReleaseBuild } from './release-feature-build.ts'
import { runReleaseCheck } from './release-feature-check.ts'

export type ReleaseCommandDeps = {
  runReleaseBuild?: (options: ReleaseBuildCommandOptions) => Promise<number>
  runReleaseCheck?: (options: ReleaseCheckCommandOptions) => Promise<number>
}

export function createReleaseCommand({
  runReleaseBuild: runReleaseBuildCommand = runReleaseBuild,
  runReleaseCheck: runReleaseCheckCommand = runReleaseCheck,
}: ReleaseCommandDeps = {}): Command {
  const releaseCommand = new Command('release').description('Prepare an app for a Solana dApp Store release')

  releaseCommand.action(() => {
    releaseCommand.outputHelp()
  })

  releaseCommand
    .command('build [directory]')
    .description('Build a signed release APK of an Expo project for the dApp Store')
    .option('--keystore-alias <alias>', 'Alias of the release key in the keystore')
    .option('--keystore-path <path>', 'Release keystore to sign the APK with')
    .option('--out <path>', 'Where to write the APK (default: next to the Gradle output)')
    .option('--stacktrace', 'Pass --stacktrace to Gradle')
    .action(async (directory: string | undefined, options: Omit<ReleaseBuildCommandOptions, 'directory'>) => {
      process.exitCode = await runReleaseBuildCommand({ ...options, directory })
    })

  releaseCommand
    .command('check [directory]')
    .description('Check that an Expo project is ready for a dApp Store release')
    .option('--apk <path>', 'Also check a built release APK: its package, versions and signing certificate')
    .option('--json', 'Print a stable JSON report')
    .option('--verbose', 'Include diagnostic details')
    .action(async (directory: string | undefined, options: Omit<ReleaseCheckCommandOptions, 'directory'>) => {
      process.exitCode = await runReleaseCheckCommand({ ...options, directory })
    })

  return releaseCommand
}
