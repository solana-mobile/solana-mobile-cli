import { Command } from 'commander'
import type { ReleaseCheckCommandOptions } from './data-access/release-types.ts'
import { runReleaseCheck } from './release-feature-check.ts'

export type ReleaseCommandDeps = {
  runReleaseCheck?: (options: ReleaseCheckCommandOptions) => Promise<number>
}

export function createReleaseCommand({
  runReleaseCheck: runReleaseCheckCommand = runReleaseCheck,
}: ReleaseCommandDeps = {}): Command {
  const releaseCommand = new Command('release').description('Prepare an app for a Solana dApp Store release')

  releaseCommand.action(() => {
    releaseCommand.outputHelp()
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
