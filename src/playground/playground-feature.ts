import { Command, InvalidArgumentError } from 'commander'
import { parseIntegerOption } from '../core/ui/core-ui-command-options.ts'
import { parsePlaygroundClusterId } from './data-access/playground-clusters.ts'
import type { PlaygroundClusterId, PlaygroundCommandOptions } from './data-access/playground-types.ts'
import { runPlayground } from './playground-feature-index.ts'

export type PlaygroundCommandDeps = {
  runPlayground?: (options: PlaygroundCommandOptions) => Promise<void>
}

export function createPlaygroundCommand({
  runPlayground: runPlaygroundCommand = runPlayground,
}: PlaygroundCommandDeps = {}): Command {
  return new Command('playground')
    .description('Serve a wallet testing page and open it on a connected device')
    .option('--cluster <cluster>', 'Cluster: devnet, localnet, mainnet, or testnet', parseClusterOption)
    .option('--device <serial>', 'Target a device serial')
    .option('--no-open', 'Do not open the page on the device')
    .option('--port <port>', 'Host port for the playground server', parseIntegerOption)
    .option('--url <url>', 'Custom RPC URL for the selected cluster')
    .option('-v, --verbose', 'Verbose output')
    .action(async (options: PlaygroundCommandOptions) => {
      await runPlaygroundCommand(options)
    })
}

/**
 * Commander only renders a concise usage error for `InvalidArgumentError`; anything else escapes parsing
 * and the built CLI prints a stack trace. The cluster parser itself stays free of Commander so it can be
 * used outside the CLI boundary.
 */
function parseClusterOption(value: string): PlaygroundClusterId {
  try {
    return parsePlaygroundClusterId(value)
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error))
  }
}
