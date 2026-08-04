import { resolve } from 'node:path'
import { cancel, intro, outro } from '@clack/prompts'
import { checkTemplateRepository } from './data-access/template-repository.ts'

export interface TemplatesCheckCommandOptions {
  root?: string
}

interface RunTemplatesCheckDependencies {
  cancel?: (message: string) => void
  checkRepository?: typeof checkTemplateRepository
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function runTemplatesCheck(
  options: TemplatesCheckCommandOptions = {},
  {
    cancel: showCancel = cancel,
    checkRepository = checkTemplateRepository,
    intro: showIntro = intro,
    outro: showOutro = outro,
  }: RunTemplatesCheckDependencies = {},
) {
  try {
    showIntro('solana-mobile templates check')

    const { issues } = checkRepository(resolve(options.root ?? process.cwd()))

    if (issues.length > 0) {
      showCancel(`Template repository check failed:\n- ${issues.join('\n- ')}`)
      process.exitCode = 1
      return
    }

    showOutro('Template artifacts are up to date')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
