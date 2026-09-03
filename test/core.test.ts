import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CreateAppArgs, Template, TemplateJsonTemplate } from 'create-solana-dapp'
import { createApp, runApp } from '../src/app.ts'
import { readPackageMetadata } from '../src/core/data-access/package-metadata.ts'
import { checkForNewerVersion, isVersionGreater } from '../src/core/data-access/version-check.ts'
import { formatUpdateWarning } from '../src/core/ui/core-ui-update-warning.ts'
import { formatCliCommand } from '../src/core/util/format-cli-command.ts'
import { readPackageString } from '../src/core/util/read-package-string.ts'
import type { CreateCommandOptions, CreateSolanaDappApi } from '../src/create/create-feature-index.ts'
import { getInitialProjectName, MINIMAL_TEMPLATE_NAME, runCreate } from '../src/create/create-feature-index.ts'
import { projectNameSchema, validateProjectName } from '../src/create/data-access/validate-project-name.ts'
import type { DeviceTuneCommandOptions } from '../src/device/device-feature-index.ts'
import type {
  EmulatorCreateCommandOptions,
  EmulatorDeleteCommandOptions,
  EmulatorImagesCommandOptions,
  EmulatorImagesDeleteCommandOptions,
  EmulatorImagesInstallCommandOptions,
  EmulatorStartCommandOptions,
  EmulatorStatusCommandOptions,
  EmulatorStopCommandOptions,
  EmulatorTuneCommandOptions,
} from '../src/emulator/emulator-feature-index.ts'
import type {
  LocalnetForwardCommandOptions,
  LocalnetStartCommandOptions,
  LocalnetStatusCommandOptions,
  LocalnetStopCommandOptions,
} from '../src/localnet/localnet-feature-index.ts'
import type {
  TemplatesCheckCommandOptions,
  TemplatesGenerateCommandOptions,
} from '../src/templates/templates-feature-index.ts'

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

describe('version check', () => {
  const metadata = { description: 'CLI for Solana Mobile development.', name: 'solana-mobile', version: '0.1.3' }

  test('compares release versions', () => {
    expect(isVersionGreater('0.2.0', '0.1.3')).toBe(true)
    expect(isVersionGreater('1.0.0', '0.9.9')).toBe(true)
    expect(isVersionGreater('0.1.4', '0.1.3')).toBe(true)
    expect(isVersionGreater('0.1.3', '0.1.3')).toBe(false)
    expect(isVersionGreater('0.1.2', '0.1.3')).toBe(false)
    expect(isVersionGreater('not-a-version', '0.1.3')).toBe(false)
    expect(isVersionGreater('0.2.0', 'not-a-version')).toBe(false)
  })

  test('reports a newer published version', async () => {
    const result = await checkForNewerVersion({
      env: {},
      fetchLatestVersion: async () => '0.2.0',
      isTty: true,
      metadata,
    })

    expect(result).toEqual({ current: '0.1.3', latest: '0.2.0' })
  })

  test('reports nothing when up to date', async () => {
    const result = await checkForNewerVersion({
      env: {},
      fetchLatestVersion: async () => '0.1.3',
      isTty: true,
      metadata,
    })

    expect(result).toBeUndefined()
  })

  test('reports nothing when the registry is unreachable', async () => {
    const result = await checkForNewerVersion({
      env: {},
      fetchLatestVersion: async () => undefined,
      isTty: true,
      metadata,
    })

    expect(result).toBeUndefined()
  })

  test('skips in CI, tests, opt-out, and without a terminal', async () => {
    let fetchCalled = false
    const fetchLatestVersion = async () => {
      fetchCalled = true
      return '0.2.0'
    }

    expect(
      await checkForNewerVersion({ env: { CI: 'true' }, fetchLatestVersion, isTty: true, metadata }),
    ).toBeUndefined()
    expect(
      await checkForNewerVersion({ env: { NODE_ENV: 'test' }, fetchLatestVersion, isTty: true, metadata }),
    ).toBeUndefined()
    expect(
      await checkForNewerVersion({
        env: { SOLANA_MOBILE_SKIP_VERSION_CHECK: '1' },
        fetchLatestVersion,
        isTty: true,
        metadata,
      }),
    ).toBeUndefined()
    expect(await checkForNewerVersion({ env: {}, fetchLatestVersion, isTty: false, metadata })).toBeUndefined()
    expect(fetchCalled).toBe(false)
  })

  test('does not skip when CI is explicitly disabled', async () => {
    const result = await checkForNewerVersion({
      env: { CI: 'false' },
      fetchLatestVersion: async () => '0.2.0',
      isTty: true,
      metadata,
    })

    expect(result).toEqual({ current: '0.1.3', latest: '0.2.0' })
  })

  test('skips preview builds', async () => {
    let fetchCalled = false
    const result = await checkForNewerVersion({
      env: {},
      fetchLatestVersion: async () => {
        fetchCalled = true
        return '0.2.0'
      },
      isTty: true,
      metadata: { ...metadata, version: '0.0.0-canary-20260804175003' },
    })

    expect(result).toBeUndefined()
    expect(fetchCalled).toBe(false)
  })

  test('formats the update warning for a global install', () => {
    expect(formatUpdateWarning({ current: '0.1.3', latest: '0.2.0' }, {})).toBe(
      [
        'A new version of solana-mobile is available: 0.1.3 → 0.2.0',
        'Run npm install -g solana-mobile@latest to update.',
        'Pass --skip-version-check to skip this check.',
      ].join('\n'),
    )
  })

  test('formats the update warning for a package runner', () => {
    const warning = formatUpdateWarning(
      { current: '0.1.3', latest: '0.2.0' },
      { npm_command: 'exec', npm_lifecycle_event: 'npx' },
    )

    expect(warning).toContain('Run npx solana-mobile@latest to use the latest version.')
  })

  test('formats the update warning for a project dependency', () => {
    // A package script does not match a package runner; a global install would not update the
    // dependency actually being executed.
    const warning = formatUpdateWarning(
      { current: '0.1.3', latest: '0.2.0' },
      {
        npm_command: 'run-script',
        npm_config_user_agent: 'pnpm/10.33.0 npm/? node/v24.5.0 darwin arm64',
        npm_lifecycle_event: 'mobile',
      },
    )

    expect(warning).toContain('Update the solana-mobile dependency in your project to get the latest version.')
    expect(warning).not.toContain('npm install -g')
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
      'device',
      'doctor',
      'emulator',
      'localnet',
      'playground',
      'templates',
      'webshell',
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

  test('warns before a command when a newer version is available', async () => {
    const errors: string[] = []
    const error = console.error

    console.error = ((message: unknown) => {
      errors.push(String(message))
    }) as typeof console.error

    try {
      const app = createApp({
        checkForNewerVersion: async () => ({ current: '0.1.3', latest: '0.2.0' }),
        runEmulatorList: async () => {},
      })

      await app.parseAsync(['node', 'solana-mobile', 'emulator', 'list'])
    } finally {
      console.error = error
    }

    expect(errors.join('\n')).toContain('A new version of solana-mobile is available: 0.1.3 → 0.2.0')
  })

  test('skips the version check with --skip-version-check', async () => {
    let checkCalled = false
    const app = createApp({
      checkForNewerVersion: async () => {
        checkCalled = true
        return undefined
      },
      runEmulatorList: async () => {},
    })

    await app.parseAsync(['node', 'solana-mobile', '--skip-version-check', 'emulator', 'list'])

    expect(checkCalled).toBe(false)
  })

  test('accepts --skip-version-check after the subcommand', async () => {
    let checkCalled = false
    const app = createApp({
      checkForNewerVersion: async () => {
        checkCalled = true
        return undefined
      },
      runEmulatorImages: async () => {},
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'images', 'list', '--skip-version-check'])

    expect(checkCalled).toBe(false)
  })

  test('registers device subcommands', () => {
    const deviceCommand = createApp().commands.find((command) => command.name() === 'device')

    expect(deviceCommand?.commands.map((command) => command.name())).toEqual(['install', 'list', 'open', 'tune'])
  })

  test('delegates device tune command options', async () => {
    const deviceTuneOptions: DeviceTuneCommandOptions[] = []
    const app = createApp({
      runDeviceTune: async (options) => {
        deviceTuneOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'device', 'tune', '--device', 'SM02E4072816572'])
    await app.parseAsync(['node', 'solana-mobile', 'device', 'tune', '--all', '-y'])

    expect(deviceTuneOptions).toEqual([{ device: 'SM02E4072816572' }, { all: true, yes: true }])
  })

  test('rejects device tune with both --all and --device', async () => {
    const app = createAppWithSilencedDeviceTuneCommand()

    await expect(
      app.parseAsync(['node', 'solana-mobile', 'device', 'tune', '--all', '--device', 'SM02E4072816572']),
    ).rejects.toThrow(`The --all flag can't be used in combination with --device`)
  })

  test('delegates emulator tune command options', async () => {
    const emulatorTuneOptions: EmulatorTuneCommandOptions[] = []
    const app = createApp({
      runEmulatorTune: async (options) => {
        emulatorTuneOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'tune'])
    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'tune', 'Alpha', '--yes'])

    expect(emulatorTuneOptions).toEqual([{ nameOrSerial: undefined }, { nameOrSerial: 'Alpha', yes: true }])
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
      'tune',
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

    await expect(app.parseAsync(['node', 'solana-mobile', 'localnet', '--engine', 'geyser'])).rejects.toThrow(
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

    expect(templatesCommand?.commands.map((command) => command.name())).toEqual(['check', 'generate', 'sync'])
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

  test('delegates templates generate command options', async () => {
    const templatesGenerateOptions: TemplatesGenerateCommandOptions[] = []
    const app = createApp({
      runTemplatesGenerate: async (options) => {
        templatesGenerateOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates', 'generate', '--root', '/repo'])

    expect(templatesGenerateOptions).toEqual([{ root: '/repo' }])
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
      '--tune',
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
        tune: true,
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

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'start', 'Alpha', '--sdk-root', '/sdk', '--tune'])

    expect(emulatorStartOptions).toEqual([{ name: 'Alpha', sdkRoot: '/sdk', tune: true }])
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

function createAppWithSilencedDeviceTuneCommand() {
  const app = createApp({ runDeviceTune: async () => {} })
  const deviceCommand = app.commands.find((command) => command.name() === 'device')

  app.exitOverride()
  app.configureOutput({ writeErr: () => {}, writeOut: () => {} })
  deviceCommand?.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} })
  deviceCommand?.commands
    .find((command) => command.name() === 'tune')
    ?.exitOverride()
    .configureOutput({ writeErr: () => {}, writeOut: () => {} })

  return app
}

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
