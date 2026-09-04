import { Command } from 'commander'
import { runTemplatesCheck, type TemplatesCheckCommandOptions } from './templates-feature-check.ts'
import { runTemplatesGenerate, type TemplatesGenerateCommandOptions } from './templates-feature-generate.ts'
import { runTemplatesSync, type TemplatesSyncCommandOptions } from './templates-feature-sync.ts'

export type TemplatesCommandDeps = {
  runTemplatesCheck?: (options: TemplatesCheckCommandOptions) => Promise<void>
  runTemplatesGenerate?: (options: TemplatesGenerateCommandOptions) => Promise<void>
  runTemplatesSync?: (options: TemplatesSyncCommandOptions) => Promise<void>
}

export function createTemplatesCommand({
  runTemplatesCheck: runTemplatesCheckCommand = runTemplatesCheck,
  runTemplatesGenerate: runTemplatesGenerateCommand = runTemplatesGenerate,
  runTemplatesSync: runTemplatesSyncCommand = runTemplatesSync,
}: TemplatesCommandDeps = {}): Command {
  const templatesCommand = new Command('templates').description('Manage template repositories')

  templatesCommand.action(() => {
    templatesCommand.outputHelp()
  })

  templatesCommand
    .command('check')
    .description('Check generated template artifacts')
    .option('--root <path>', 'Template repository root')
    .action(async (options: TemplatesCheckCommandOptions) => {
      await runTemplatesCheckCommand(options)
    })

  templatesCommand
    .command('generate')
    .description('Generate template artifacts')
    .option('--root <path>', 'Template repository root')
    .action(async (options: TemplatesGenerateCommandOptions) => {
      await runTemplatesGenerateCommand(options)
    })

  templatesCommand
    .command('sync <target>')
    .description('Sync git-tracked templates to another template repository')
    .option('--dry-run', 'Show what would change without writing')
    .option('--force', 'Sync even if the target has uncommitted changes')
    .option('--root <path>', 'Template repository root')
    .action(async (target: string, options: Omit<TemplatesSyncCommandOptions, 'target'>) => {
      await runTemplatesSyncCommand({ ...options, target })
    })

  return templatesCommand
}
