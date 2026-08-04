import { cancel, intro, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { inspectLocalnetContainer, readLocalnetContainerLogs } from './data-access/docker-engine.ts'
import type { DockerDependencies, LocalnetLogsCommandOptions } from './data-access/localnet-types.ts'

export interface RunLocalnetLogsDependencies extends DockerDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runLocalnetLogs(
  options: LocalnetLogsCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    outro: showOutro = outro,
    runCommand = runExecutable,
  }: RunLocalnetLogsDependencies = {},
) {
  try {
    const container = await inspectLocalnetContainer({ runCommand })

    if (!container.status) {
      showIntro('solana-mobile localnet logs')
      console.log('No localnet container exists.')
      showOutro('Done')
      process.exitCode = 1
      return
    }

    process.stdout.write(await readLocalnetContainerLogs({ lines: options.lines }, { runCommand }))
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
