import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import type { CreateAppArgs, Template, TemplateJsonTemplate } from 'create-solana-dapp'
import { createApp } from '../src/app.ts'
import type { CreateCommandOptions, CreateSolanaDappApi } from '../src/create/create-feature-index.ts'
import { getInitialProjectName, runCreate } from '../src/create/create-feature-index.ts'
import { MINIMAL_TEMPLATE_NAME } from '../src/create/data-access/template-catalog.ts'
import { projectNameSchema, validateProjectName } from '../src/create/data-access/validate-project-name.ts'

const template: TemplateJsonTemplate = {
  description: 'A Solana Mobile template',
  id: 'gh:solana-mobile/templates/mobile/expo-kit-wallet',
  keywords: [],
  name: 'expo-kit-wallet',
  path: 'mobile/expo-kit-wallet',
}
const minimalTemplate: TemplateJsonTemplate = {
  description: 'A minimal Solana Mobile template',
  id: 'gh:solana-mobile/templates/mobile/expo-kit-minimal',
  keywords: [],
  name: 'expo-kit-minimal',
  path: 'mobile/expo-kit-minimal',
}

describe('create command', () => {
  test('registers create command options', () => {
    const createCommand = createApp().commands.find((command) => command.name() === 'create')

    expect(createCommand?.options.map((option) => option.flags)).toEqual([
      '--pm, --package-manager <packageManager>',
      '-d, --dry-run',
      '-t, --template <templateName>',
      '--list-template-ids',
      '--list-templates',
      '--list-versions',
      '--minimal',
      '--skip-git',
      '--skip-init',
      '--skip-install',
      '-v, --verbose',
      '--skip-version-check',
    ])
  })

  test('delegates create command options', async () => {
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'create',
      'my-app',
      '--template',
      'mobile/expo-kit-wallet',
      '--pm',
      'pnpm',
      '--skip-git',
      '--skip-init',
      '--skip-install',
      '--verbose',
      '--dry-run',
    ])

    expect(createOptions).toEqual([
      {
        dryRun: true,
        packageManager: 'pnpm',
        projectName: 'my-app',
        skipGit: true,
        skipInit: true,
        skipInstall: true,
        template: 'mobile/expo-kit-wallet',
        templateOptions: [],
        verbose: true,
      },
    ])
  })

  test('delegates the minimal template name for --minimal', async () => {
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', 'my-app', '--minimal', '--dry-run'])

    expect(createOptions).toEqual([
      { dryRun: true, minimal: true, projectName: 'my-app', template: 'expo-kit-minimal', templateOptions: [] },
    ])
  })

  test('passes template options through to runCreate', async () => {
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', 'my-app', '--minimal', '--reset-project', '--dry-run'])

    expect(createOptions[0]).toMatchObject({ projectName: 'my-app', templateOptions: ['reset-project'] })
  })

  test('recovers the project name when a template option precedes it', async () => {
    // commander reroutes operands that follow an unknown option into the leftover args, so the
    // declared [projectName] argument would resolve to '--reset-project' here.
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', '--reset-project', 'my-app', '--dry-run'])

    expect(createOptions[0]).toMatchObject({ projectName: 'my-app', templateOptions: ['reset-project'] })
  })

  test('passes the project name after the -- separator', async () => {
    // commander keeps the literal `--` in the leftover args when an unknown option precedes it
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', '--reset-project', '--', 'sentinel-app'])

    expect(createOptions[0]).toMatchObject({ projectName: 'sentinel-app', templateOptions: ['reset-project'] })
  })

  test('treats dash-prefixed args after -- as positionals, not template options', async () => {
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', '--reset-project', '--', '--not-an-option'])

    // The invalid name is rejected later by project name validation, not silently collected as an option
    expect(createOptions[0]).toMatchObject({ projectName: '--not-an-option', templateOptions: ['reset-project'] })
  })

  test('rejects combining --minimal with --template', async () => {
    const app = createAppWithSilencedCreateCommand()

    await expect(
      app.parseAsync(['node', 'solana-mobile', 'create', 'my-app', '--minimal', '--template', 'expo-kit-wallet']),
    ).rejects.toThrow(`The --minimal flag can't be used in combination with --template`)
  })

  test('prints usage after an error, so the settings copy reaches create too', async () => {
    // `create` is registered with `addCommand` like every other feature command, so it depends on
    // createApp copying the root's `showHelpAfterError`. It cannot join the app-level guard for the
    // other commands: its `parseOptions` override collects unknown long flags as template options
    // before commander can reject them, so the error has to come from the override itself.
    const errors: string[] = []
    const app = createApp({ runCreate: async () => {} })

    app.exitOverride()
    app.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    app.commands
      .find((command) => command.name() === 'create')
      ?.exitOverride()
      .configureOutput({ writeErr: (text) => errors.push(text), writeOut: () => {} })

    await expect(app.parseAsync(['node', 'solana-mobile', 'create', '-x'])).rejects.toThrow()

    expect(errors.join('')).toContain('Usage: solana-mobile create [options] [projectName]')
  })

  test('rejects template options that are not boolean long flags', async () => {
    const app = createAppWithSilencedCreateCommand()

    await expect(app.parseAsync(['node', 'solana-mobile', 'create', 'my-app', '--reset-project=yes'])).rejects.toThrow(
      'Template options must be boolean long flags',
    )
  })

  test('rejects extra arguments', async () => {
    const app = createAppWithSilencedCreateCommand()

    await expect(app.parseAsync(['node', 'solana-mobile', 'create', 'my-app', 'extra'])).rejects.toThrow(
      'too many arguments',
    )
  })

  test('rejects template options placed after the -- separator as excess arguments', async () => {
    // Everything after `--` is positional, even when commander itself would have dropped the
    // separator before the extraction could see it
    const app = createAppWithSilencedCreateCommand()

    await expect(
      app.parseAsync(['node', 'solana-mobile', 'create', '--', 'sentinel-app', '--reset-project']),
    ).rejects.toThrow('too many arguments')
  })

  test('treats a lone dash-prefixed arg after -- as the project name', async () => {
    const createOptions: CreateCommandOptions[] = []
    const app = createApp({
      runCreate: async (options) => {
        createOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'create', '--', '--not-an-option'])

    // Rejected later by project name validation, not silently collected as a template option
    expect(createOptions[0]).toMatchObject({ projectName: '--not-an-option', templateOptions: [] })
  })

  test('shows help for create --help instead of collecting it as a template option', async () => {
    // The help option is registered outside `command.options`, so the extraction special-cases it
    const app = createAppWithSilencedCreateCommand()
    let helpText = ''
    app.commands
      .find((command) => command.name() === 'create')
      ?.configureOutput({
        writeErr: () => {},
        writeOut: (text) => {
          helpText += text
        },
      })

    await expect(app.parseAsync(['node', 'solana-mobile', 'create', '--help'])).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
    })
    expect(helpText).toContain('Usage: solana-mobile create')
  })

  test('resolves the minimal template name from the catalog', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    await runCreate(
      { projectName: 'my-app', skipInstall: true, template: MINIMAL_TEMPLATE_NAME },
      {
        createSolanaDapp,
        selectTemplate: async () => template,
      },
    )

    expect(createAppArgs).toMatchObject([{ template: minimalTemplate }])
  })

  test('creates with selected template using create-solana-dapp API', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    await runCreate(
      { projectName: 'my-app', skipInstall: true },
      {
        createSolanaDapp,
        selectTemplate: async () => template,
      },
    )

    expect(createAppArgs).toMatchObject([
      {
        dryRun: false,
        name: 'my-app',
        packageManager: 'bun',
        // Detected rather than selected, so createApp may switch to a template-required manager
        packageManagerExplicit: false,
        skipGit: false,
        skipInit: false,
        skipInstall: true,
        template,
        verbose: false,
      },
    ])
  })

  test('marks an explicitly selected package manager as explicit', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    await runCreate(
      { packageManager: 'pnpm', projectName: 'my-app', skipInstall: true },
      {
        createSolanaDapp,
        selectTemplate: async () => template,
      },
    )

    expect(createAppArgs).toMatchObject([{ packageManager: 'pnpm', packageManagerExplicit: true }])
  })

  test('rejects an invalid positional project name before creating', async () => {
    // The positional name flows into the generated package.json and the rename search key, so it
    // gets the same validation as the prompt
    const previousExitCode = process.exitCode
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    try {
      await runCreate(
        { projectName: 'My_App', skipInstall: true, template: 'expo-kit-wallet' },
        {
          createSolanaDapp,
          selectTemplate: async () => template,
        },
      )

      expect(createAppArgs).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('creates without selecting when template is provided', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })
    let selectCalled = false

    await runCreate(
      { projectName: 'my-app', skipInstall: true, template: 'expo-kit-wallet' },
      {
        createSolanaDapp,
        selectTemplate: async () => {
          selectCalled = true
          return template
        },
      },
    )

    expect(createAppArgs).toMatchObject([{ template }])
    expect(selectCalled).toBe(false)
  })

  test('forwards template options to create-solana-dapp', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    await runCreate(
      {
        projectName: 'my-app',
        skipInstall: true,
        template: 'expo-kit-wallet',
        templateOptions: ['reset-project'],
      },
      {
        createSolanaDapp,
        selectTemplate: async () => template,
      },
    )

    expect(createAppArgs).toMatchObject([{ templateOptions: ['reset-project'] }])
  })

  test('passes the selected template to the project name prompt', async () => {
    // The prompt pre-fills the project name from the selected template, so it needs the selection
    const createSolanaDapp = createMockCreateSolanaDapp()
    let promptedTemplate: Template | undefined

    await runCreate(
      { skipInstall: true },
      {
        createSolanaDapp,
        promptProjectName: async (_createSolanaDapp, template) => {
          promptedTemplate = template
          return 'my-app'
        },
        selectTemplate: async () => template,
      },
    )

    expect(promptedTemplate).toBe(template)
  })

  test('derives the initial project name from the template name', () => {
    expect(getInitialProjectName(template)).toBe('expo-kit-wallet')
    // External templates keep their raw reference as the name; only the last segment is usable
    expect(getInitialProjectName({ ...template, name: 'solana-mobile/templates' })).toBe('templates')
    expect(getInitialProjectName({ ...template, name: 'solana-mobile/templates/' })).toBe('templates')
    // An invalid candidate is dropped rather than rewritten
    expect(getInitialProjectName({ ...template, name: 'My_Template' })).toBeUndefined()
  })

  test('passes an absolute local template path through as a local template', async () => {
    // Without the local branch the path is prefixed with `gh:` and cloning fails
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })
    const localTemplate = resolve(process.cwd(), 'test/fixtures/template-repository/mobile/example')

    await runCreate(
      { projectName: 'my-app', skipInstall: true, template: localTemplate },
      { createSolanaDapp, selectTemplate: async () => template },
    )

    expect(createAppArgs).toMatchObject([
      { template: { description: `${localTemplate} (local)`, id: `local:${localTemplate}`, name: localTemplate } },
    ])
  })

  test('resolves a relative local template path against the working directory', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })
    const relativeTemplate = './test/fixtures/template-repository/mobile/example'

    await runCreate(
      { projectName: 'my-app', skipInstall: true, template: relativeTemplate },
      { createSolanaDapp, selectTemplate: async () => template },
    )

    expect(createAppArgs).toMatchObject([
      { template: { id: `local:${resolve(process.cwd(), relativeTemplate)}`, name: relativeTemplate } },
    ])
  })

  test('rejects a local template path that does not exist', async () => {
    const previousExitCode = process.exitCode
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    try {
      await runCreate(
        { projectName: 'my-app', skipInstall: true, template: '/does-not-exist/solana-mobile-template' },
        { createSolanaDapp, selectTemplate: async () => template },
      )

      expect(createAppArgs).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('keeps treating a bare owner/repo template as an external GitHub reference', async () => {
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })

    await runCreate(
      { projectName: 'my-app', skipInstall: true, template: 'solana-mobile/templates/mobile/expo-kit-anchor' },
      { createSolanaDapp, selectTemplate: async () => template },
    )

    expect(createAppArgs).toMatchObject([{ template: { id: 'gh:solana-mobile/templates/mobile/expo-kit-anchor' } }])
  })

  test('exits when createApp fails so the leftover spinner cannot hang the process', async () => {
    // create-solana-dapp leaves its spinner running when a task throws, and the spinner keeps the
    // event loop alive, so returning normally here would hang until the user interrupts
    const previousExitCode = process.exitCode
    const exitCodes: number[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppError: new Error('Error cloning the template') })

    try {
      await runCreate(
        { projectName: 'my-app', skipInstall: true, template: 'expo-kit-wallet' },
        { createSolanaDapp, exit: (code) => exitCodes.push(code), selectTemplate: async () => template },
      )

      expect(exitCodes).toEqual([1])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('returns without exiting when the failure happens before createApp', async () => {
    // No spinner is running yet, so returning lets stdout flush instead of truncating it
    const previousExitCode = process.exitCode
    const exitCodes: number[] = []
    const createSolanaDapp = createMockCreateSolanaDapp()

    try {
      await runCreate(
        { projectName: 'My_App', skipInstall: true, template: 'expo-kit-wallet' },
        { createSolanaDapp, exit: (code) => exitCodes.push(code), selectTemplate: async () => template },
      )

      expect(exitCodes).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('stops before prompting a project name when template selection is canceled', async () => {
    const previousExitCode = process.exitCode
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })
    let promptCalled = false

    try {
      await runCreate(
        {},
        {
          createSolanaDapp,
          promptProjectName: async () => {
            promptCalled = true
            return 'my-app'
          },
          selectTemplate: async () => undefined,
        },
      )

      expect(createAppArgs).toEqual([])
      expect(process.exitCode).toBe(1)
      expect(promptCalled).toBe(false)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })
})

describe('validate project name', () => {
  test.each(['a', 'app', 'my-app', 'my-app-2', 'web3'])('accepts %p', (name) => {
    expect(validateProjectName(name)).toBeUndefined()
  })

  test.each([
    '-app',
    '9lives',
    '@scope/app',
    'My-App',
    'app-',
    'my app',
    'my--app',
    'my.app',
    'my_app',
  ])('rejects %p', (name) => {
    expect(validateProjectName(name)).toBe(
      'Please enter a valid project name (lowercase letters, numbers, and single dashes, starting with a letter)',
    )
  })

  test('rejects an empty name', () => {
    expect(validateProjectName('')).toBe('Please enter at least 1 character')
  })

  test('rejects a name longer than 214 characters', () => {
    expect(validateProjectName('a'.repeat(215))).toBe('Please enter a name with at most 214 characters')
  })

  test('accepts a name of exactly 214 characters', () => {
    expect(validateProjectName('a'.repeat(214))).toBeUndefined()
  })

  test('rejects a valid name when the directory already exists', () => {
    // bun test runs from the repo root, where `src` exists
    expect(validateProjectName('src')).toBe('Directory already exists')
  })

  test('does not check the filesystem in the schema alone', () => {
    expect(projectNameSchema.safeParse('src').success).toBe(true)
  })
})

function createAppWithSilencedCreateCommand() {
  const app = createApp({ runCreate: async () => {} })

  app.exitOverride()
  app.configureOutput({ writeErr: () => {}, writeOut: () => {} })
  app.commands
    .find((command) => command.name() === 'create')
    ?.exitOverride()
    .configureOutput({ writeErr: () => {}, writeOut: () => {} })

  return app
}

function createMockCreateSolanaDapp({
  createAppArgs = [],
  createAppError,
}: {
  createAppArgs?: CreateAppArgs[]
  createAppError?: Error
} = {}) {
  return {
    createApp: async (args) => {
      createAppArgs.push(args)
      if (createAppError) {
        throw createAppError
      }
      return ['Install dependencies:']
    },
    detectInvokedPackageManager: () => 'bun',
    fetchTemplateData: async () => ({ items: [], templates: [minimalTemplate, template] }),
    finalNote: () => 'Done',
    getAppInfo: () => ({ name: 'create-solana-dapp', version: '4.8.5' }),
    listTemplateIds: ({ templates }) => templates.map((template) => template.id),
    listTemplates: () => {},
    listVersions: () => {},
    validateProjectName,
  } satisfies CreateSolanaDappApi
}
