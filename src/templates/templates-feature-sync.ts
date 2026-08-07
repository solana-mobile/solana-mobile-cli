import { resolve } from 'node:path'
import { cancel, intro, log, outro } from '@clack/prompts'
import {
  applyTemplateSync,
  listWorkTreeChanges,
  planTemplateSync,
  type TemplateSyncAction,
  type TemplateSyncDependencies,
} from './data-access/sync-template-repository.ts'
import { checkTemplateRepository } from './data-access/template-repository.ts'

export interface TemplatesSyncCommandOptions {
  dryRun?: boolean
  force?: boolean
  root?: string
  target: string
}

interface RunTemplatesSyncDependencies extends TemplateSyncDependencies {
  applySync?: typeof applyTemplateSync
  cancel?: (message: string) => void
  checkRepository?: typeof checkTemplateRepository
  info?: (message: string) => void
  intro?: (message: string) => void
  listChanges?: typeof listWorkTreeChanges
  outro?: (message: string) => void
  planSync?: typeof planTemplateSync
  warn?: (message: string) => void
}

export async function runTemplatesSync(
  options: TemplatesSyncCommandOptions,
  {
    applySync = applyTemplateSync,
    cancel: showCancel = cancel,
    checkRepository = checkTemplateRepository,
    info: showInfo = log.info,
    intro: showIntro = intro,
    listChanges = listWorkTreeChanges,
    listIgnoredFiles,
    listTrackedFiles,
    outro: showOutro = outro,
    planSync = planTemplateSync,
    warn: showWarn = log.warn,
  }: RunTemplatesSyncDependencies = {},
) {
  try {
    showIntro('solana-mobile templates sync')

    const source = resolve(options.root ?? process.cwd())
    const target = resolve(options.target)
    const { issues } = checkRepository(source)

    if (issues.length > 0) {
      showCancel(`Source repository check failed:\n- ${issues.join('\n- ')}`)
      process.exitCode = 1
      return
    }

    const plan = await planSync(source, target, { listIgnoredFiles, listTrackedFiles })
    const changes = plan.actions.filter((action) => action.action !== 'unchanged')

    for (const action of changes) {
      showInfo(`${action.action.padEnd(6)} ${action.path}`)
    }

    if (changes.length === 0) {
      showOutro(`Target repository is up to date with ${plan.groups.join(', ')}`)
      return
    }

    if (options.dryRun) {
      showOutro(`Dry run: ${summarize(plan.actions)} — nothing was written`)
      return
    }

    // The sync recursively deletes every added, updated, and removed template in the target, so uncommitted
    // target work under the synced groups would be lost irrecoverably. A clean working tree keeps everything
    // the sync overwrites restorable from git.
    if (!options.force) {
      const uncommitted = await listChanges(target, plan.groups)

      if (uncommitted.length > 0) {
        showCancel(
          `Target repository has uncommitted changes under ${plan.groups.join(', ')}:\n- ${uncommitted.join('\n- ')}\nCommit or stash them, or pass --force to overwrite.`,
        )
        process.exitCode = 1
        return
      }
    }

    const kept = applySync(source, target, plan)

    for (const path of kept) {
      showWarn(`${path}: directory kept because it still contains gitignored files — remove it manually`)
    }

    showOutro(`Synced ${plan.groups.join(', ')} to ${target}: ${summarize(plan.actions)}. Regenerate artifacts there.`)
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

function summarize(actions: TemplateSyncAction[]): string {
  const count = (kind: TemplateSyncAction['action']) => actions.filter((action) => action.action === kind).length

  return `${count('add')} added, ${count('update')} updated, ${count('remove')} removed, ${count('unchanged')} unchanged`
}
