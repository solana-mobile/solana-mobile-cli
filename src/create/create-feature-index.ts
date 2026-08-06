import { resolve } from 'node:path'
import { cancel, intro, isCancel, log, note, outro, select, text } from '@clack/prompts'
import { type Command, InvalidArgumentError, type Option } from 'commander'
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
import { projectNameSchema, validateProjectName } from './data-access/validate-project-name.ts'

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

const templateOptionPattern = /^--([a-z][a-z0-9-]*)$/

/**
 * Extracts template-defined option flags such as `--reset-project` from the create command's raw
 * arguments before commander parses them, mirroring the extraction create-solana-dapp performs on
 * its own argv. Working on the raw arguments is what keeps `--` semantics intact — commander drops
 * the separator (or keeps it, depending on what precedes it) before leftovers are visible — and it
 * leaves commander's own unknown-option and excess-argument checks active for everything that
 * remains. create-solana-dapp validates the collected names against the options the cloned
 * template declares.
 */
export function extractTemplateOptions(
  command: Command,
  args: string[],
): { args: string[]; templateOptions: string[] } {
  const remaining: string[] = []
  const templateOptions = new Set<string>()
  let positionalOnly = false
  let preserveNextArgument = false

  for (const arg of args) {
    if (positionalOnly || preserveNextArgument) {
      remaining.push(arg)
      preserveNextArgument = false
      continue
    }

    if (arg === '--') {
      positionalOnly = true
      remaining.push(arg)
      continue
    }

    const knownOption = findKnownOption(command, arg)

    if (knownOption) {
      remaining.push(arg)
      preserveNextArgument = Boolean(knownOption.required) && !hasInlineValue(arg)
      continue
    }

    // The help option is registered outside `command.options`, so it needs its own pass-through
    if (!arg.startsWith('-') || arg === '-h' || arg === '--help') {
      remaining.push(arg)
      continue
    }

    const name = templateOptionPattern.exec(arg)?.[1]

    if (!name) {
      throw new InvalidArgumentError(
        `Template options must be boolean long flags such as --reset-project; received "${arg}".`,
      )
    }

    templateOptions.add(name)
  }

  return { args: remaining, templateOptions: [...templateOptions] }
}

function findKnownOption(command: Command, arg: string): Option | undefined {
  // Check both flags: a dual-flag option such as `--pm, --package-manager` stores `--pm` as `short`
  const flag = arg.startsWith('--') ? (arg.split('=', 1)[0] ?? arg) : arg.slice(0, 2)

  return command.options.find((option) => option.short === flag || option.long === flag)
}

// A value attached to the flag itself (`--pm=pnpm`, `-tvalue`) means the next argument is not its value
function hasInlineValue(arg: string): boolean {
  return arg.startsWith('--') ? arg.includes('=') : arg.length > 2
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
