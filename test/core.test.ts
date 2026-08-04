import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CreateAppArgs, TemplateJsonTemplate } from 'create-solana-dapp'
import { createApp, runApp } from '../src/app.ts'
import { readPackageMetadata } from '../src/core/data-access/package-metadata.ts'
import { formatCliCommand } from '../src/core/util/format-cli-command.ts'
import { readPackageString } from '../src/core/util/read-package-string.ts'
import type { CreateCommandOptions, CreateSolanaDappApi } from '../src/create/create-feature-index.ts'
import { MINIMAL_TEMPLATE_NAME, runCreate } from '../src/create/create-feature-index.ts'
import type {
  EmulatorCreateCommandOptions,
  EmulatorDeleteCommandOptions,
  EmulatorImagesCommandOptions,
  EmulatorImagesDeleteCommandOptions,
  EmulatorImagesInstallCommandOptions,
  EmulatorStartCommandOptions,
  EmulatorStatusCommandOptions,
  EmulatorStopCommandOptions,
} from '../src/emulator/emulator-feature-index.ts'
import type {
  LocalnetForwardCommandOptions,
  LocalnetStartCommandOptions,
  LocalnetStatusCommandOptions,
  LocalnetStopCommandOptions,
} from '../src/localnet/localnet-feature-index.ts'
import type { TemplatesCheckCommandOptions } from '../src/templates/templates-feature-index.ts'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  description: string
  name: string
  version: string
}
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

describe('core', () => {
  test('formats direct CLI commands', () => {
    expect(formatCliCommand('emulator stop Alpha', {})).toBe('solana-mobile emulator stop Alpha')
  })

  test('formats npx CLI commands', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_command: 'exec',
        npm_lifecycle_event: 'npx',
      }),
    ).toBe('npx solana-mobile emulator stop Alpha')
  })

  test('formats bunx CLI commands', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_command: 'exec',
        npm_lifecycle_event: 'bunx',
      }),
    ).toBe('bunx solana-mobile emulator stop Alpha')
  })

  test('formats pnpm dlx CLI commands', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_config_user_agent: 'pnpm/10.33.0 npm/? node/v24.5.0 darwin arm64',
      }),
    ).toBe('pnpm dlx solana-mobile emulator stop Alpha')
  })

  test('formats yarn dlx CLI commands', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_config_user_agent: 'yarn/4.9.2 npm/? node/v24.5.0 darwin arm64',
      }),
    ).toBe('yarn dlx solana-mobile emulator stop Alpha')
  })

  test('does not treat pnpm exec as pnpm dlx', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_command: 'exec',
        npm_config_user_agent: 'pnpm/10.33.0 npm/? node/v24.5.0 darwin arm64',
      }),
    ).toBe('solana-mobile emulator stop Alpha')
  })

  test('does not treat pnpm run as pnpm dlx', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_command: 'run-script',
        npm_config_user_agent: 'pnpm/10.33.0 npm/? node/v24.5.0 darwin arm64',
        npm_lifecycle_event: 'mytest',
      }),
    ).toBe('solana-mobile emulator stop Alpha')
  })

  test('does not treat yarn run as yarn dlx', () => {
    expect(
      formatCliCommand('emulator stop Alpha', {
        npm_config_user_agent: 'yarn/1.22.22 npm/? node/v24.5.0 darwin arm64',
        npm_lifecycle_event: 'mytest',
      }),
    ).toBe('solana-mobile emulator stop Alpha')
  })

  test('reads package metadata', () => {
    expect(readPackageMetadata()).toEqual({
      description: packageJson.description,
      name: packageJson.name,
      version: packageJson.version,
    })
  })

  test('requires package metadata strings', () => {
    expect(() => readPackageString({ name: 123 }, 'name')).toThrow('package.json name must be a string')
  })
})

describe('app', () => {
  test('uses package metadata', () => {
    const app = createApp()

    expect(app.description()).toBe(packageJson.description)
    expect(app.name()).toBe(packageJson.name)
    expect(app.version()).toBe(packageJson.version)
  })

  test('registers commands', () => {
    expect(createApp().commands.map((command) => command.name())).toEqual([
      'create',
      'doctor',
      'emulator',
      'localnet',
      'templates',
    ])
  })

  test('prints command help without arguments', async () => {
    const output: string[] = []
    const write = process.stdout.write
    let createCalled = false
    let doctorCalled = false

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    try {
      await runApp(['node', 'solana-mobile'], {
        runCreate: async () => {
          createCalled = true
        },
        runDoctor: async () => {
          doctorCalled = true
          return 0
        },
      })
    } finally {
      process.stdout.write = write
    }

    expect(output.join('')).toContain('Commands:')
    expect(output.join('')).toContain('create')
    expect(output.join('')).toContain('doctor')
    expect(output.join('')).toContain('emulator')
    expect(output.join('')).toContain('templates')
    expect(createCalled).toBe(false)
    expect(doctorCalled).toBe(false)
  })

  test('registers emulator alias and subcommands', () => {
    const emulatorCommand = createApp().commands.find((command) => command.name() === 'emulator')

    expect(emulatorCommand?.aliases()).toEqual(['emu'])
    expect(emulatorCommand?.commands.map((command) => command.name())).toEqual([
      'create',
      'delete',
      'images',
      'list',
      'start',
      'status',
      'stop',
    ])
  })

  test('registers localnet subcommands', () => {
    const localnetCommand = createApp().commands.find((command) => command.name() === 'localnet')

    expect(localnetCommand?.commands.map((command) => command.name())).toEqual([
      'start',
      'check',
      'forward',
      'logs',
      'status',
      'stop',
    ])
  })

  test('runs localnet start when no subcommand is given, watching by default', async () => {
    const startOptions: LocalnetStartCommandOptions[] = []
    const app = createApp({
      runLocalnetStart: async (options) => {
        startOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'localnet'])

    expect(startOptions).toEqual([
      {
        detach: undefined,
        devices: [],
        engine: undefined,
        image: undefined,
        port: undefined,
        studioPort: undefined,
        watch: true,
        wsPort: undefined,
      },
    ])
  })

  test('disables watching with --no-watch', async () => {
    const startOptions: LocalnetStartCommandOptions[] = []
    const app = createApp({
      runLocalnetStart: async (options) => {
        startOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'localnet', 'start', '--no-watch', '--detach'])

    expect(startOptions[0]?.watch).toBe(false)
    expect(startOptions[0]?.detach).toBe(true)
  })

  test('accepts localnet options on either side of the subcommand', async () => {
    // Regression guard: `localnet` and its subcommands declare the same flags, and commander stores each
    // flag on whichever level parsed it. Reading only the subcommand's own options silently dropped
    // everything written before the subcommand — `localnet --detach start` ran attached.
    const startOptions: LocalnetStartCommandOptions[] = []
    const parse = (argv: string[]) =>
      createApp({
        runLocalnetStart: async (options) => {
          startOptions.push(options)
        },
      }).parseAsync(['node', 'solana-mobile', ...argv])

    const flags = ['--detach', '--no-watch', '--device', 'emulator-5554', '--port', '9899']

    await parse(['localnet', 'start', ...flags])
    await parse(['localnet', ...flags, 'start'])

    // Both placements have to produce the same options, defaults included.
    expect(startOptions[1]).toEqual(startOptions[0] as LocalnetStartCommandOptions)
    expect(startOptions[0]).toMatchObject({ detach: true, devices: ['emulator-5554'], port: 9899, watch: false })
  })

  test('passes localnet target options written before the subcommand to every subcommand', async () => {
    const statusOptions: LocalnetStatusCommandOptions[] = []
    const stopOptions: LocalnetStopCommandOptions[] = []
    const app = createApp({
      runLocalnetStatus: async (options) => {
        statusOptions.push(options)
      },
      runLocalnetStop: async (options) => {
        stopOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'localnet',
      '--engine',
      'test-validator',
      '--port',
      '9899',
      'status',
    ])
    await app.parseAsync(['node', 'solana-mobile', 'localnet', '--engine', 'test-validator', 'stop'])

    expect(statusOptions[0]).toMatchObject({ engine: 'test-validator', port: 9899 })
    expect(stopOptions[0]).toMatchObject({ engine: 'test-validator' })
  })

  test('collects repeatable localnet device options and host port overrides', async () => {
    const forwardOptions: LocalnetForwardCommandOptions[] = []
    const app = createApp({
      runLocalnetForward: async (options) => {
        forwardOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'localnet',
      'forward',
      '--device',
      'emulator-5554',
      '--device',
      '39281FDJH00KL2',
      '--port',
      '9899',
      '--watch',
    ])

    expect(forwardOptions[0]?.devices).toEqual(['emulator-5554', '39281FDJH00KL2'])
    expect(forwardOptions[0]?.port).toBe(9899)
    expect(forwardOptions[0]?.watch).toBe(true)
  })

  test('rejects an unknown localnet engine', async () => {
    const app = createApp({ runLocalnetStart: async () => {} })

    app.exitOverride()
    app.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    app.commands
      .find((command) => command.name() === 'localnet')
      ?.exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })

    expect(app.parseAsync(['node', 'solana-mobile', 'localnet', '--engine', 'geyser'])).rejects.toThrow(
      'Unknown localnet engine: geyser',
    )
  })

  test('does not delegate emulator command to list', async () => {
    const emulatorListOptions: Array<Record<string, never>> = []
    const app = createApp({
      runEmulatorList: async (options) => {
        emulatorListOptions.push(options)
      },
    })

    app.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    })
    app.commands
      .find((command) => command.name() === 'emulator')
      ?.configureOutput({
        writeErr: () => {},
        writeOut: () => {},
      })

    await app.parseAsync(['node', 'solana-mobile', 'emulator'])

    expect(emulatorListOptions).toEqual([])
  })

  test('delegates emulator list command options', async () => {
    const emulatorListOptions: Array<Record<string, never>> = []
    const app = createApp({
      runEmulatorList: async (options) => {
        emulatorListOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'list'])

    expect(emulatorListOptions).toEqual([{}])
  })

  test('delegates emulator alias list command options', async () => {
    const emulatorListOptions: Array<Record<string, never>> = []
    const app = createApp({
      runEmulatorList: async (options) => {
        emulatorListOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emu', 'list'])

    expect(emulatorListOptions).toEqual([{}])
  })

  test('registers templates subcommands', () => {
    const templatesCommand = createApp().commands.find((command) => command.name() === 'templates')

    expect(templatesCommand?.commands.map((command) => command.name())).toEqual(['check'])
  })

  test('does not delegate templates command to check', async () => {
    const templatesCheckOptions: TemplatesCheckCommandOptions[] = []
    const app = createApp({
      runTemplatesCheck: async (options) => {
        templatesCheckOptions.push(options)
      },
    })
    const templatesCommand = app.commands.find((command) => command.name() === 'templates')

    templatesCommand?.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates'])

    expect(templatesCheckOptions).toEqual([])
  })

  test('delegates templates check command options', async () => {
    const templatesCheckOptions: TemplatesCheckCommandOptions[] = []
    const app = createApp({
      runTemplatesCheck: async (options) => {
        templatesCheckOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates', 'check', '--root', '/repo'])

    expect(templatesCheckOptions).toEqual([{ root: '/repo' }])
  })

  test('does not delegate emulator images command to list', async () => {
    const emulatorImagesOptions: EmulatorImagesCommandOptions[] = []
    const app = createApp({
      runEmulatorImages: async (options) => {
        emulatorImagesOptions.push(options)
      },
    })

    const emulatorImagesCommand = app.commands
      .find((command) => command.name() === 'emulator')
      ?.commands.find((command) => command.name() === 'images')

    emulatorImagesCommand?.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'images'])

    expect(emulatorImagesCommand?.commands.map((command) => command.name())).toEqual(['delete', 'install', 'list'])
    expect(emulatorImagesOptions).toEqual([])
  })

  test('delegates emulator images delete command options', async () => {
    const emulatorImagesDeleteOptions: EmulatorImagesDeleteCommandOptions[] = []
    const app = createApp({
      runEmulatorImagesDelete: async (options) => {
        emulatorImagesDeleteOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'emulator',
      'images',
      'delete',
      'system-images/android-35/google_apis_playstore/arm64-v8a',
      'system-images/android-36/google_apis_playstore/arm64-v8a',
      '--sdk-root',
      '/sdk',
    ])

    expect(emulatorImagesDeleteOptions).toEqual([
      {
        sdkRoot: '/sdk',
        systemImages: [
          'system-images/android-35/google_apis_playstore/arm64-v8a',
          'system-images/android-36/google_apis_playstore/arm64-v8a',
        ],
      },
    ])
  })

  test('delegates emulator images install command options', async () => {
    const emulatorImagesInstallOptions: EmulatorImagesInstallCommandOptions[] = []
    const app = createApp({
      runEmulatorImagesInstall: async (options) => {
        emulatorImagesInstallOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'emulator',
      'images',
      'install',
      'system-images/android-36.1/google_apis_playstore/arm64-v8a',
      '--all',
      '--sdk-root',
      '/sdk',
      '--verbose',
    ])

    expect(emulatorImagesInstallOptions).toEqual([
      {
        all: true,
        sdkRoot: '/sdk',
        systemImage: 'system-images/android-36.1/google_apis_playstore/arm64-v8a',
        verbose: true,
      },
    ])
  })

  test('delegates emulator images list command options', async () => {
    const emulatorImagesOptions: EmulatorImagesCommandOptions[] = []
    const app = createApp({
      runEmulatorImages: async (options) => {
        emulatorImagesOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'images', 'list', '--sdk-root', '/sdk'])

    expect(emulatorImagesOptions).toEqual([{ sdkRoot: '/sdk' }])
  })

  test('delegates emulator create command options', async () => {
    const emulatorCreateOptions: EmulatorCreateCommandOptions[] = []
    const app = createApp({
      runEmulatorCreate: async (options) => {
        emulatorCreateOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'emulator',
      'create',
      'test_phone',
      '--data-size',
      '16G',
      '--device',
      'pixel_9',
      '--profile',
      'solana-mobile',
      '--ram-mb',
      '4096',
      '--sdcard-size',
      '256M',
      '--sdk-root',
      '/sdk',
      '--start',
      '--system-image',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
      '--verbose',
      '--vm-heap-mb',
      '384',
    ])

    expect(emulatorCreateOptions).toEqual([
      {
        dataSize: '16G',
        device: 'pixel_9',
        name: 'test_phone',
        profile: 'solana-mobile',
        ramMb: 4096,
        sdcardSize: '256M',
        sdkRoot: '/sdk',
        start: true,
        systemImage: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        verbose: true,
        vmHeapMb: 384,
      },
    ])
  })

  test('delegates emulator delete command options', async () => {
    const emulatorDeleteOptions: EmulatorDeleteCommandOptions[] = []
    const app = createApp({
      runEmulatorDelete: async (options) => {
        emulatorDeleteOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'delete', 'Alpha', 'Beta', '--sdk-root', '/sdk'])

    expect(emulatorDeleteOptions).toEqual([{ names: ['Alpha', 'Beta'], sdkRoot: '/sdk' }])
  })

  test('delegates emulator delete without names', async () => {
    const emulatorDeleteOptions: EmulatorDeleteCommandOptions[] = []
    const app = createApp({
      runEmulatorDelete: async (options) => {
        emulatorDeleteOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'delete'])

    expect(emulatorDeleteOptions).toEqual([{ names: [] }])
  })

  test('delegates emulator start command options', async () => {
    const emulatorStartOptions: EmulatorStartCommandOptions[] = []
    const app = createApp({
      runEmulatorStart: async (options) => {
        emulatorStartOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'start', 'Alpha', '--sdk-root', '/sdk'])

    expect(emulatorStartOptions).toEqual([{ name: 'Alpha', sdkRoot: '/sdk' }])
  })

  test('delegates emulator start without name', async () => {
    const emulatorStartOptions: EmulatorStartCommandOptions[] = []
    const app = createApp({
      runEmulatorStart: async (options) => {
        emulatorStartOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'start'])

    expect(emulatorStartOptions).toEqual([{ name: undefined }])
  })

  test('delegates emulator stop command options', async () => {
    const emulatorStopOptions: EmulatorStopCommandOptions[] = []
    const app = createApp({
      runEmulatorStop: async (options) => {
        emulatorStopOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'stop', 'Alpha'])

    expect(emulatorStopOptions).toEqual([{ nameOrSerial: 'Alpha' }])
  })

  test('delegates emulator status command options', async () => {
    const emulatorStatusOptions: EmulatorStatusCommandOptions[] = []
    const app = createApp({
      runEmulatorStatus: async (options) => {
        emulatorStatusOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'status', 'Alpha'])

    expect(emulatorStatusOptions).toEqual([{ nameOrSerial: 'Alpha' }])
  })

  test('delegates emulator status without name or serial', async () => {
    const emulatorStatusOptions: EmulatorStatusCommandOptions[] = []
    const app = createApp({
      runEmulatorStatus: async (options) => {
        emulatorStatusOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'status'])

    expect(emulatorStatusOptions).toEqual([{ nameOrSerial: undefined }])
  })

  test('delegates emulator stop without name or serial', async () => {
    const emulatorStopOptions: EmulatorStopCommandOptions[] = []
    const app = createApp({
      runEmulatorStop: async (options) => {
        emulatorStopOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'stop'])

    expect(emulatorStopOptions).toEqual([{ nameOrSerial: undefined }])
  })

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
      { dryRun: true, minimal: true, projectName: 'my-app', template: 'expo-kit-minimal' },
    ])
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
        skipGit: false,
        skipInit: false,
        skipInstall: true,
        template,
        verbose: false,
      },
    ])
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

  test('stops before selecting a template when project name is canceled', async () => {
    const previousExitCode = process.exitCode
    const createAppArgs: CreateAppArgs[] = []
    const createSolanaDapp = createMockCreateSolanaDapp({ createAppArgs })
    let selectCalled = false

    try {
      await runCreate(
        {},
        {
          createSolanaDapp,
          promptProjectName: async () => undefined,
          selectTemplate: async () => {
            selectCalled = true
            return template
          },
        },
      )

      expect(createAppArgs).toEqual([])
      expect(process.exitCode).toBe(1)
      expect(selectCalled).toBe(false)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })
})

function createMockCreateSolanaDapp({ createAppArgs = [] }: { createAppArgs?: CreateAppArgs[] } = {}) {
  return {
    createApp: async (args) => {
      createAppArgs.push(args)
      return ['Install dependencies:']
    },
    detectInvokedPackageManager: () => 'bun',
    fetchTemplateData: async () => ({ items: [], templates: [minimalTemplate, template] }),
    finalNote: () => 'Done',
    getAppInfo: () => ({ name: 'create-solana-dapp', version: '4.8.5' }),
    listTemplateIds: ({ templates }) => templates.map((template) => template.id),
    listTemplates: () => {},
    listVersions: () => {},
    validateProjectName: (name) => (name ? undefined : 'Please enter at least 1 character'),
  } satisfies CreateSolanaDappApi
}
