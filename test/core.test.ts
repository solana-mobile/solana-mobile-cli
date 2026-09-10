import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createApp, runApp } from '../src/app.ts'
import {
  defaultAndroidSdkRoot,
  listAndroidSdkRootCandidates,
  resolveAndroidSdkRoot,
} from '../src/core/data-access/android-sdk-root.ts'
import { executableFileNames, findExecutable } from '../src/core/data-access/executable-lookup.ts'
import { readPackageMetadata } from '../src/core/data-access/package-metadata.ts'
import { resolveSpawnCommand } from '../src/core/data-access/run-executable.ts'
import { checkForNewerVersion, isVersionGreater } from '../src/core/data-access/version-check.ts'
import { formatUpdateWarning } from '../src/core/ui/core-ui-update-warning.ts'
import { formatCliCommand } from '../src/core/util/format-cli-command.ts'
import { readPackageString } from '../src/core/util/read-package-string.ts'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  description: string
  name: string
  version: string
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

describe('android sdk root', () => {
  test('prefers ANDROID_HOME over the deprecated ANDROID_SDK_ROOT', () => {
    const options = { environment: { ANDROID_HOME: '/home-sdk', ANDROID_SDK_ROOT: '/root-sdk' }, homeDirectory: '/u' }

    expect(resolveAndroidSdkRoot({ ...options, platform: 'linux' })).toBe('/home-sdk')
    expect(listAndroidSdkRootCandidates({ ...options, platform: 'linux' })).toEqual([
      { path: '/home-sdk', source: 'ANDROID_HOME' },
      { path: '/root-sdk', source: 'ANDROID_SDK_ROOT' },
      { path: join('/u', 'Android', 'Sdk'), source: 'default location' },
    ])
    expect(resolveAndroidSdkRoot({ environment: { ANDROID_SDK_ROOT: '/root-sdk' }, platform: 'linux' })).toBe(
      '/root-sdk',
    )
  })

  test('falls back to the Android Studio default for each platform', () => {
    expect(defaultAndroidSdkRoot({ environment: {}, homeDirectory: '/Users/test', platform: 'darwin' })).toBe(
      join('/Users/test', 'Library', 'Android', 'sdk'),
    )
    expect(defaultAndroidSdkRoot({ environment: {}, homeDirectory: '/home/test', platform: 'linux' })).toBe(
      join('/home/test', 'Android', 'Sdk'),
    )
    expect(
      defaultAndroidSdkRoot({
        environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
        homeDirectory: 'C:\\Users\\test',
        platform: 'win32',
      }),
    ).toBe(join('C:\\Users\\test\\AppData\\Local', 'Android', 'Sdk'))
    expect(defaultAndroidSdkRoot({ environment: {}, homeDirectory: 'C:\\Users\\test', platform: 'win32' })).toBe(
      join('C:\\Users\\test', 'AppData', 'Local', 'Android', 'Sdk'),
    )
  })
})

describe('executable lookup', () => {
  test('only accepts Windows executable extensions on win32', () => {
    expect(executableFileNames('adb', 'darwin')).toEqual(['adb'])
    expect(executableFileNames('adb', 'win32')).toEqual(['adb.exe', 'adb.bat', 'adb.cmd'])
  })

  test('searches preferred directories before PATH', async () => {
    const existing = new Set([join('/usr/bin', 'adb'), join('/sdk/platform-tools', 'adb')])
    const pathExists = async (filePath: string) => existing.has(filePath)
    const environment = { PATH: ['/usr/bin', '/opt/bin'].join(delimiter) }

    expect(await findExecutable('adb', { environment, pathExists, platform: 'linux' })).toBe(join('/usr/bin', 'adb'))
    expect(
      await findExecutable('adb', {
        environment,
        pathExists,
        platform: 'linux',
        preferredDirectories: ['/sdk/platform-tools'],
      }),
    ).toBe(join('/sdk/platform-tools', 'adb'))
    expect(await findExecutable('missing', { environment, pathExists, platform: 'linux' })).toBeUndefined()
  })

  test('skips the extensionless shell script on Windows', async () => {
    const existing = new Set([join('C:\\tools\\bin', 'avdmanager'), join('C:\\tools\\bin', 'avdmanager.bat')])

    expect(
      await findExecutable('avdmanager', {
        environment: {},
        pathExists: async (filePath) => existing.has(filePath),
        platform: 'win32',
        preferredDirectories: ['C:\\tools\\bin'],
      }),
    ).toBe(join('C:\\tools\\bin', 'avdmanager.bat'))
  })
})

describe('spawn command', () => {
  test('leaves commands alone outside Windows and for real executables', () => {
    expect(resolveSpawnCommand(['/sdk/bin/avdmanager', 'list'], 'darwin')).toEqual(['/sdk/bin/avdmanager', 'list'])
    expect(resolveSpawnCommand(['C:\\sdk\\emulator\\emulator.exe', '@Alpha'], 'win32')).toEqual([
      'C:\\sdk\\emulator\\emulator.exe',
      '@Alpha',
    ])
    expect(resolveSpawnCommand(['adb', 'devices'], 'win32')).toEqual(['adb', 'devices'])
  })

  test('runs batch files through cmd.exe on Windows', () => {
    expect(resolveSpawnCommand(['C:\\sdk\\bin\\avdmanager.bat', 'list', 'avd'], 'win32')).toEqual([
      'cmd.exe',
      '/c',
      'C:\\sdk\\bin\\avdmanager.bat',
      'list',
      'avd',
    ])
    expect(resolveSpawnCommand(['C:\\app\\gradlew.BAT', 'assembleRelease'], 'win32')[0]).toBe('cmd.exe')
    expect(resolveSpawnCommand(['C:\\tools\\npm.cmd', '--version'], 'win32')[0]).toBe('cmd.exe')
  })

  test('refuses cmd.exe metacharacters in batch file arguments', () => {
    expect(() => resolveSpawnCommand(['C:\\app\\gradlew.bat', '-Pkeystore=evil&calc.keystore'], 'win32')).toThrow(
      'contains characters cmd.exe would interpret',
    )
    expect(() => resolveSpawnCommand(['C:\\my app\\gradlew.bat', 'assembleRelease'], 'win32')).not.toThrow()
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

  test('copies the root settings into every feature-owned command', async () => {
    // Commander copies the root's settings into commands made with `command()` but not into ones
    // passed to `addCommand`, which is how every feature-owned command is registered. Without
    // createApp's copy pass they each lose `showHelpAfterError` (and `enablePositionalOptions`), so
    // this asserts the behaviour on all of them at once rather than one feature at a time.
    for (const name of ['device', 'doctor', 'emulator', 'localnet', 'playground', 'templates', 'webshell']) {
      const errors: string[] = []
      const app = createApp()
      const command = app.commands.find((child) => child.name() === name)

      app.exitOverride()
      app.configureOutput({ writeErr: () => {}, writeOut: () => {} })
      command?.exitOverride().configureOutput({ writeErr: (text) => errors.push(text), writeOut: () => {} })

      await expect(app.parseAsync(['node', 'solana-mobile', name, '--bogus'])).rejects.toThrow(
        "unknown option '--bogus'",
      )

      expect(errors.join('')).toContain(`Usage: solana-mobile ${name}`)
    }
  })
})
