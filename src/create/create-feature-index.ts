import { resolve } from 'node:path'
import { cancel, intro, isCancel, log, note, outro, select, text } from '@clack/prompts'
import { InvalidArgumentError } from 'commander'
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
  validateProjectName,
} from 'create-solana-dapp'

export const CUSTOM_TEMPLATES_URL = 'https://raw.githubusercontent.com/solana-mobile/templates/main/templates.json'

// Must match a template name in CUSTOM_TEMPLATES_URL, otherwise `--minimal` falls through to `gh:` resolution.
export const MINIMAL_TEMPLATE_NAME = 'expo-kit-minimal'

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
  promptProjectName?: (createSolanaDapp: CreateSolanaDappApi) => Promise<string | undefined>
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
    promptProjectName: promptProjectNameInput = promptProjectName,
    selectTemplate = selectCustomTemplate,
  }: RunCreateOptions = {},
) {
  try {
    const createSolanaDapp = injectedCreateSolanaDapp ?? createSolanaDappApi
    const packageManager = options.packageManager ?? createSolanaDapp.detectInvokedPackageManager()

    if (options.listVersions) {
      createSolanaDapp.listVersions()
      return
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

    const projectName = options.projectName ?? (await promptProjectNameInput(createSolanaDapp))

    if (!projectName) {
      process.exitCode = 1
      return
    }

    const template = options.template ? resolveTemplate(options.template, templates) : await selectTemplate(templates)

    if (!template) {
      process.exitCode = 1
      return
    }

    const targetDirectory = resolve(process.cwd(), projectName)
    const createArgs: CreateAppArgs = {
      app: createSolanaDapp.getAppInfo(),
      dryRun: options.dryRun ?? false,
      name: projectName,
      packageManager,
      skipGit: options.skipGit ?? false,
      skipInit: options.skipInit ?? false,
      skipInstall: options.skipInstall ?? false,
      targetDirectory,
      template,
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
  }
}

export function parsePackageManagerOption(next: string): PackageManager {
  if (!next || !isPackageManager(next)) {
    throw new InvalidArgumentError(`Invalid package manager: ${next}`)
  }

  return next
}

function isPackageManager(value: string): value is PackageManager {
  return value === 'bun' || value === 'npm' || value === 'pnpm' || value === 'yarn'
}

async function promptProjectName(createSolanaDapp: CreateSolanaDappApi) {
  const projectName = await text({
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

function resolveTemplate(templateName: string, templates: TemplateJsonTemplate[]): Template {
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
