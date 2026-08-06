import { resolve } from 'node:path'
import { cancel, intro, log, outro } from '@clack/prompts'
import { writeTemplateRepository } from './data-access/template-repository.ts'

export interface TemplatesGenerateCommandOptions {
  root?: string
}

interface RunTemplatesGenerateDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  writeRepository?: typeof writeTemplateRepository
}

export async function runTemplatesGenerate(
  options: TemplatesGenerateCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    log: showLog = log.info,
    outro: showOutro = outro,
    writeRepository = writeTemplateRepository,
  }: RunTemplatesGenerateDependencies = {},
) {
  try {
    showIntro('solana-mobile templates generate')

    const results = writeRepository(resolve(options.root ?? process.cwd()))

    for (const result of results) {
      showLog(`${result.path}: ${result.status}`)
    }

    const written = results.filter((result) => result.status === 'written').length

    showOutro(written > 0 ? `Generated ${written} of ${results.length} artifacts` : 'Template artifacts are up to date')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
