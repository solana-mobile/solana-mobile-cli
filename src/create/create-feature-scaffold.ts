import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { cancel, intro, isCancel, log, note, outro, select, text } from '@clack/prompts'
import {
  type CreateAppArgs,
  createApp,
  detectInvokedPackageManager,
  fetchTemplateData,
  finalNote,
  getAppInfo,
  listTemplateIds,
  listTemplates,
  listVersions,
  type MenuConfig,
  type PackageManager,
  type Template,
  type TemplateJsonTemplate,
} from 'create-solana-dapp'
import { CUSTOM_TEMPLATES_URL } from './data-access/template-catalog.ts'
import { projectNameSchema, validateProjectName } from './data-access/validate-project-name.ts'

const SOLANA_MOBILE_MENU_CONFIG: MenuConfig = [
  {
    description: 'Solana Mobile templates',
    groups: ['mobile'],
    id: 'solana-mobile',
    keywords: [],
    name: 'Solana Mobile',
  },
]

type CreateOptions = {
  dryRun?: boolean
  listTemplateIds?: boolean
  listTemplates?: boolean
  listVersions?: boolean
  minimal?: boolean
  packageManager?: PackageManager
  projectName?: string
  skipGit?: boolean
  skipInit?: boolean
  skipInstall?: boolean
  template?: string
  templateOptions?: string[]
  verbose?: boolean
}
export type CreateCommandOptions = CreateOptions

export type CreateSolanaDappApi = {
  createApp: typeof createApp
  detectInvokedPackageManager: typeof detectInvokedPackageManager
  fetchTemplateData: typeof fetchTemplateData
  finalNote: typeof finalNote
  getAppInfo: typeof getAppInfo
  listTemplateIds: typeof listTemplateIds
  listTemplates: typeof listTemplates
  listVersions: typeof listVersions
  validateProjectName: typeof validateProjectName
}

type RunCreateOptions = {
  createSolanaDapp?: CreateSolanaDappApi
  exit?: (code: number) => void
  promptProjectName?: (createSolanaDapp: CreateSolanaDappApi, template: Template) => Promise<string | undefined>
  selectTemplate?: (templates: TemplateJsonTemplate[]) => Promise<Template | undefined>
}

const createSolanaDappApi = {
  createApp,
  detectInvokedPackageManager,
  fetchTemplateData,
  finalNote,
  getAppInfo,
  listTemplateIds,
  listTemplates,
  listVersions,
  validateProjectName,
} satisfies CreateSolanaDappApi

export async function runCreate(
  options: CreateCommandOptions,
  {
    createSolanaDapp: injectedCreateSolanaDapp,
    exit = process.exit,
    promptProjectName: promptProjectNameInput = promptProjectName,
    selectTemplate = selectCustomTemplate,
  }: RunCreateOptions = {},
) {
  // create-solana-dapp's task runner never stops its spinner when a task throws, and the spinner's
  // interval and raw-mode stdin block keep the event loop alive. Once createApp has started, a
  // failure has to exit the process explicitly or the CLI hangs until it is interrupted.
  let createAppStarted = false

  try {
    const createSolanaDapp = injectedCreateSolanaDapp ?? createSolanaDappApi
    const packageManager = options.packageManager ?? createSolanaDapp.detectInvokedPackageManager()

    if (options.listVersions) {
      createSolanaDapp.listVersions()
      return
    }

    // The positional name flows into the generated package.json and the rename search key, so it
    // must pass the same validation as the interactive prompt. Validate before fetching template
    // data so a network failure can't mask the name error, but not for the informational list
    // commands, which don't create anything.
    const isListCommand = options.listTemplateIds || options.listTemplates
    if (options.projectName && !isListCommand) {
      const nameError = createSolanaDapp.validateProjectName(options.projectName)
      if (nameError) {
        throw new Error(nameError)
      }
    }

    const { templates } = await createSolanaDapp.fetchTemplateData({
      config: SOLANA_MOBILE_MENU_CONFIG,
      url: CUSTOM_TEMPLATES_URL,
      verbose: options.verbose ?? false,
    })

    if (options.listTemplates) {
      createSolanaDapp.listTemplates({ templates })
      return
    }

    if (options.listTemplateIds) {
      console.log(JSON.stringify(createSolanaDapp.listTemplateIds({ templates })))
      return
    }

    intro('solana-mobile create')

    const template = options.template ? resolveTemplate(options.template, templates) : await selectTemplate(templates)

    if (!template) {
      process.exitCode = 1
      return
    }

    const projectName = options.projectName ?? (await promptProjectNameInput(createSolanaDapp, template))

    if (!projectName) {
      process.exitCode = 1
      return
    }

    const targetDirectory = resolve(process.cwd(), projectName)
    const createArgs: CreateAppArgs = {
      app: createSolanaDapp.getAppInfo(),
      dryRun: options.dryRun ?? false,
      name: projectName,
      packageManager,
      // When the package manager was only detected, createApp may switch to one the template
      // requires; an explicitly selected mismatch fails instead.
      packageManagerExplicit: options.packageManager !== undefined,
      skipGit: options.skipGit ?? false,
      skipInit: options.skipInit ?? false,
      skipInstall: options.skipInstall ?? false,
      targetDirectory,
      template,
      templateOptions: options.templateOptions ?? [],
      verbose: options.verbose ?? false,
    }

    if (options.dryRun) {
      note(JSON.stringify(createArgs, undefined, 2), 'Arguments')
      outro('Dry run was used, no changes were made')
      return
    }

    if (options.verbose) {
      log.warn('Verbose output enabled')
      log.message(JSON.stringify(createArgs, undefined, 2))
    }

    createAppStarted = true
    const instructions = await createSolanaDapp.createApp(createArgs)

    note(
      createSolanaDapp.finalNote({
        ...createArgs,
        instructions,
        target: createArgs.targetDirectory.replace(process.cwd(), '.'),
      }),
      'Installation successful',
    )

    outro('Good luck with your project!')
  } catch (error) {
    cancel(`${error}`)
    process.exitCode = 1

    // Errors raised before createApp leave no spinner behind, so those return normally and let
    // stdout flush. clack registers its own `exit` listener, which restores the terminal.
    if (createAppStarted) {
      exit(1)
    }
  }
}

// Templates from the catalog are named with a plain slug, but external (`org/repo`) templates keep
// their raw reference as the name, so take the last path segment. Anything that still isn't a valid
// project name is dropped rather than rewritten: an invalid pre-fill is worse than none, because it
// has to be cleared before the prompt will accept anything.
export function getInitialProjectName(template: Template): string | undefined {
  const candidate = template.name.replace(/\/+$/, '').split('/').pop()

  return candidate && projectNameSchema.safeParse(candidate).success ? candidate : undefined
}

async function promptProjectName(createSolanaDapp: CreateSolanaDappApi, template: Template) {
  const projectName = await text({
    // Pre-fill from the selected template, so accepting the defaults all the way through gets a
    // working app
    initialValue: getInitialProjectName(template),
    message: 'Enter project name',
    validate: (value) => createSolanaDapp.validateProjectName(value ?? '') ?? undefined,
  })

  if (isCancel(projectName)) {
    cancel('Operation cancelled.')
    return undefined
  }

  return projectName
}

async function selectCustomTemplate(templates: TemplateJsonTemplate[]) {
  const template = await select<TemplateJsonTemplate>({
    message: 'Select a template',
    options: templates.map((template) => ({
      hint: template.description,
      label: template.name,
      value: template,
    })),
  })

  if (isCancel(template)) {
    cancel('Operation cancelled.')
    return undefined
  }

  return template
}

// Mirrors the path forms create-solana-dapp's own `findTemplate` treats as local. A bare `foo/bar`
// stays an external GitHub reference, so a local template always needs an explicit `./` or `/`.
function isLocalTemplatePath(templateName: string): boolean {
  return templateName.startsWith('/') || templateName.startsWith('./') || templateName.startsWith('../')
}

// create-solana-dapp copies `local:` templates from disk instead of downloading them. Without this
// branch a filesystem path falls through to the `gh:` default below and the clone fails.
function resolveLocalTemplate(templateName: string): Template {
  const absolutePath = isAbsolute(templateName) ? templateName : resolve(process.cwd(), templateName)

  if (!existsSync(absolutePath)) {
    throw new Error(`Local template path does not exist: ${absolutePath}`)
  }

  log.warn(
    'Please install templates you trust and have verified. This feature is only intended for local development and not to clone official templates.',
  )

  return {
    description: `${templateName} (local)`,
    id: `local:${absolutePath}`,
    name: templateName,
  }
}

function resolveTemplate(templateName: string, templates: TemplateJsonTemplate[]): Template {
  if (isLocalTemplatePath(templateName)) {
    return resolveLocalTemplate(templateName)
  }

  const template = templates.find(
    (template) =>
      template.name === templateName ||
      template.path === templateName ||
      template.id === templateName ||
      template.id.endsWith(`/${templateName}`),
  )

  if (template) {
    return template
  }

  return {
    description: `${templateName} (external)`,
    id: templateName.includes(':') ? templateName : `gh:${templateName}`,
    name: templateName,
  }
}
