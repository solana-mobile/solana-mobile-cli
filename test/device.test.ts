import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.ts'
import type { CommandRunner } from '../src/core/data-access/command-types.ts'
import type { MultiSelectPrompt, SelectPrompt, TextPrompt } from '../src/core/ui/core-ui-prompt-types.ts'
import { parseAdbReverses, parseTcpPort } from '../src/device/data-access/adb-reverse.ts'
import { findApkCatalogEntry, githubReleaseDownloadUrl } from '../src/device/data-access/apk-catalog.ts'
import type { AdbDevice, DeviceTuneCommandOptions } from '../src/device/data-access/device-types.ts'
import { defaultDownloadFile, ensureApkDownloaded } from '../src/device/data-access/download-apk.ts'
import { buildAdbInstallCommand, extractAdbInstallFailure, installApk } from '../src/device/data-access/install-apk.ts'
import { parseAdbDevices } from '../src/device/data-access/list-adb-devices.ts'
import { listConnectedDevices } from '../src/device/data-access/list-connected-devices.ts'
import { type PathKind, resolveApkArgs } from '../src/device/data-access/resolve-apk-installs.ts'
import { localhostPort, resolveOpenUrl, validateOpenUrlInput } from '../src/device/data-access/resolve-open-url.ts'
import { applyDeviceTweaks, DEVICE_TWEAKS } from '../src/device/data-access/tune-device.ts'
import { runDeviceInstall } from '../src/device/device-feature-install.ts'
import { runDeviceOpen } from '../src/device/device-feature-open.ts'
import { runDeviceTune } from '../src/device/device-feature-tune.ts'
import { describeReverse } from '../src/device/ui/device-ui-messages.ts'
import { selectOpenUrl } from '../src/device/ui/device-ui-select-open-url.ts'

/** Records every command so tests can assert on what adb was actually asked to do. */
function recordingRunner(responses: (cmd: string[]) => string): { calls: string[][]; runCommand: CommandRunner } {
  const calls: string[][] = []
  const runCommand: CommandRunner = async (cmd) => {
    calls.push([...cmd])
    return responses([...cmd])
  }

  return { calls, runCommand }
}

/**
 * A world with one healthy emulator, one healthy physical device, and one offline device. Individual
 * tests override pieces of it.
 */
function defaultResponses(cmd: string[]): string {
  if (cmd[1] === 'devices') {
    return [
      'List of devices attached',
      'OFFLINE1\toffline',
      'SM02E4072816572\tdevice',
      'emulator-5554\tdevice',
      '',
    ].join('\n')
  }

  if (cmd.includes('avd')) {
    return 'Pixel_9\nOK\n'
  }

  if (cmd.includes('getprop')) {
    return 'Seeker\n'
  }

  if (cmd.includes('--list')) {
    return ''
  }

  return ''
}

function openDependencies(runCommand: CommandRunner, prompts: { runSelect?: SelectPrompt; runText?: TextPrompt } = {}) {
  const state: { cancelled?: string; logs: string[]; notes: string[] } = { logs: [], notes: [] }

  return {
    dependencies: {
      cancel: (message: string) => {
        state.cancelled = message
      },
      intro: () => {},
      log: (message: string) => {
        state.logs.push(message)
      },
      note: (message: string, title?: string) => {
        state.notes.push(title ?? message)
      },
      outro: () => {},
      runCommand,
      ...prompts,
    },
    state,
  }
}

function commandsMatching(calls: string[][], part: string): string[][] {
  return calls.filter((cmd) => cmd.includes(part))
}

/** Accepts the pre-selected tweaks, the way pressing Enter on the picker does. */
const acceptSelectedTweaks: MultiSelectPrompt = async ({ initialValues }) => initialValues ?? []

function tuneDependencies(
  runCommand: CommandRunner,
  prompts: { runMultiselect?: MultiSelectPrompt; runSelect?: SelectPrompt } = {},
) {
  const state: { cancelled?: string; logs: string[]; notes: string[]; outro?: string } = { logs: [], notes: [] }

  return {
    dependencies: {
      cancel: (message: string) => {
        state.cancelled = message
      },
      intro: () => {},
      log: (message: string) => {
        state.logs.push(message)
      },
      note: (message: string, title?: string) => {
        state.notes.push(title ?? message)
      },
      outro: (message: string) => {
        state.outro = message
      },
      runCommand,
      runMultiselect: acceptSelectedTweaks,
      ...prompts,
    },
    state,
  }
}

/** Every adb invocation the named tweaks imply for one device, in order. No names means all of them. */
function tweakCommands(serial: string, ...names: string[]): string[][] {
  return DEVICE_TWEAKS.filter(({ name }) => names.length === 0 || names.includes(name)).flatMap((tweak) =>
    tweak.commands.map((command) => ['adb', '-s', serial, 'shell', ...command]),
  )
}

/** The tweak calls a tune made, without the name probes `listConnectedDevices` runs first. */
function tweakCalls(calls: string[][]): string[][] {
  return calls.filter((cmd) => cmd.includes('shell') && !cmd.includes('getprop'))
}

describe('resolve-open-url', () => {
  test('turns a bare port into a localhost URL', () => {
    expect(resolveOpenUrl('3000')).toBe('http://localhost:3000')
  })

  test('rejects a port outside the TCP range', () => {
    expect(() => resolveOpenUrl('0')).toThrow('Invalid port: 0')
    expect(() => resolveOpenUrl('65536')).toThrow('Invalid port: 65536')
  })

  test('rejects an empty value', () => {
    expect(() => resolveOpenUrl('  ')).toThrow('Expected a URL or port')
  })

  test('passes URLs with a scheme through untouched', () => {
    expect(resolveOpenUrl('http://localhost:18488/')).toBe('http://localhost:18488/')
    expect(resolveOpenUrl('myapp://claim?id=123')).toBe('myapp://claim?id=123')
  })

  test('prefixes a bare host with http', () => {
    expect(resolveOpenUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveOpenUrl('example.com/page')).toBe('http://example.com/page')
  })

  test('validateOpenUrlInput reports the error instead of throwing', () => {
    expect(validateOpenUrlInput('http://localhost:3000')).toBeUndefined()
    expect(validateOpenUrlInput('8081')).toBeUndefined()
    expect(validateOpenUrlInput('')).toBe('Expected a URL or port')
    expect(validateOpenUrlInput('99999')).toBe('Invalid port: 99999')
  })
})

describe('localhostPort', () => {
  test('extracts the explicit port of a localhost URL', () => {
    expect(localhostPort('http://localhost:18488/')).toBe(18488)
    expect(localhostPort('http://127.0.0.1:3000/page')).toBe(3000)
  })

  test('ignores URLs that leave the host', () => {
    expect(localhostPort('http://example.com:3000')).toBeUndefined()
    expect(localhostPort('myapp://claim?id=123')).toBeUndefined()
  })

  test('ignores localhost URLs without an explicit port', () => {
    expect(localhostPort('http://localhost/')).toBeUndefined()
  })

  test('ignores values that are not URLs', () => {
    expect(localhostPort('not a url')).toBeUndefined()
  })
})

describe('listConnectedDevices', () => {
  test('names emulators by AVD and physical devices by model', async () => {
    const { runCommand } = recordingRunner(defaultResponses)

    expect(await listConnectedDevices({ runCommand })).toEqual([
      { name: 'Pixel_9', serial: 'emulator-5554', state: 'device' },
      { serial: 'OFFLINE1', state: 'offline' },
      { name: 'Seeker', serial: 'SM02E4072816572', state: 'device' },
    ])
  })

  test('never shells into a device that is not ready', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)

    await listConnectedDevices({ runCommand })

    expect(calls.filter((cmd) => cmd.includes('OFFLINE1'))).toEqual([])
  })

  test('keeps a device whose name lookup fails', async () => {
    const { runCommand } = recordingRunner((cmd) => {
      if (cmd.includes('getprop') || cmd.includes('avd')) {
        throw new Error('device went away')
      }

      return defaultResponses(cmd)
    })

    expect(await listConnectedDevices({ runCommand })).toEqual([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'OFFLINE1', state: 'offline' },
      { serial: 'SM02E4072816572', state: 'device' },
    ])
  })
})

describe('describeReverse', () => {
  test('names a known port', () => {
    expect(describeReverse({ devicePort: 18488, hostPort: 18488 })).toBe('Surfpool Studio')
  })

  test('reports a moved host port', () => {
    expect(describeReverse({ devicePort: 18488, hostPort: 9488 })).toBe('Surfpool Studio, forwards to host port 9488')
    expect(describeReverse({ devicePort: 4000, hostPort: 4100 })).toBe('forwards to host port 4100')
  })

  test('says nothing about an unknown port', () => {
    expect(describeReverse({ devicePort: 4000, hostPort: 4000 })).toBeUndefined()
  })
})

describe('selectOpenUrl', () => {
  test('offers the existing reverses plus free-text entry', async () => {
    let offered: Array<{ label: string; value: string }> = []
    const runSelect: SelectPrompt = async (options) => {
      offered = options.options
      return 'http://localhost:8081'
    }

    const url = await selectOpenUrl([{ devicePort: 8081, hostPort: 8081 }], { runSelect })

    expect(url).toBe('http://localhost:8081')
    expect(offered.map(({ label }) => label)).toEqual(['http://localhost:8081', 'Enter a URL or port'])
  })

  test('falls through to free-text entry and resolves shorthand', async () => {
    const runSelect: SelectPrompt = async () => 'enter-url'
    const runText: TextPrompt = async () => '3000'

    expect(await selectOpenUrl([{ devicePort: 8081, hostPort: 8081 }], { runSelect, runText })).toBe(
      'http://localhost:3000',
    )
  })

  test('skips the picker entirely when there are no reverses', async () => {
    const runSelect: SelectPrompt = async () => {
      throw new Error('should not be called')
    }
    const runText: TextPrompt = async () => 'http://localhost:9000'

    expect(await selectOpenUrl([], { runSelect, runText })).toBe('http://localhost:9000')
  })
})

describe('runDeviceOpen', () => {
  const oneDeviceWorld = (cmd: string[]): string => {
    if (cmd[1] === 'devices') {
      return 'List of devices attached\nSM02E4072816572\tdevice\n'
    }

    return defaultResponses(cmd)
  }

  test('forwards the port of a localhost URL before opening it', async () => {
    const { calls, runCommand } = recordingRunner(oneDeviceWorld)
    const { dependencies } = openDependencies(runCommand)

    await runDeviceOpen({ url: 'http://localhost:18488/' }, dependencies)

    expect(commandsMatching(calls, 'reverse')).toEqual([
      ['adb', '-s', 'SM02E4072816572', 'reverse', '--list'],
      ['adb', '-s', 'SM02E4072816572', 'reverse', 'tcp:18488', 'tcp:18488'],
    ])
    expect(commandsMatching(calls, 'am')).toEqual([
      [
        'adb',
        '-s',
        'SM02E4072816572',
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'http://localhost:18488/',
      ],
    ])
  })

  test('keeps an existing reverse instead of clobbering it', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd.includes('--list')) {
        // Points at a moved host port, the way `localnet --studio-port` leaves it. Replacing it would
        // break the very tunnel the user is opening.
        return 'host-1 tcp:18488 tcp:9488\n'
      }

      return oneDeviceWorld(cmd)
    })
    const { dependencies } = openDependencies(runCommand)

    await runDeviceOpen({ url: 'http://localhost:18488/' }, dependencies)

    expect(commandsMatching(calls, 'reverse')).toEqual([['adb', '-s', 'SM02E4072816572', 'reverse', '--list']])
  })

  test('does not touch reverses with --no-forward', async () => {
    const { calls, runCommand } = recordingRunner(oneDeviceWorld)
    const { dependencies } = openDependencies(runCommand)

    await runDeviceOpen({ forward: false, url: 'http://localhost:18488/' }, dependencies)

    expect(commandsMatching(calls, 'reverse')).toEqual([])
    expect(commandsMatching(calls, 'am')).toHaveLength(1)
  })

  test('does not touch reverses for a URL that leaves the host', async () => {
    const { calls, runCommand } = recordingRunner(oneDeviceWorld)
    const { dependencies } = openDependencies(runCommand)

    await runDeviceOpen({ url: 'https://example.com' }, dependencies)

    expect(commandsMatching(calls, 'reverse')).toEqual([])
    expect(commandsMatching(calls, 'am')).toHaveLength(1)
  })

  test('resolves a bare port argument', async () => {
    const { calls, runCommand } = recordingRunner(oneDeviceWorld)
    const { dependencies } = openDependencies(runCommand)

    await runDeviceOpen({ url: '8081' }, dependencies)

    expect(commandsMatching(calls, 'am').at(0)?.at(-1)).toBe('http://localhost:8081')
  })

  test('prompts for the device when several are connected', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const runSelect: SelectPrompt = async () => 'emulator-5554'
    const { dependencies } = openDependencies(runCommand, { runSelect })

    await runDeviceOpen({ url: 'https://example.com' }, dependencies)

    expect(commandsMatching(calls, 'am').at(0)?.at(2)).toBe('emulator-5554')
  })

  test('suggests the existing reverses when no URL is given, and lists them only once', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd.includes('--list')) {
        return 'host-1 tcp:8081 tcp:8081\nhost-1 tcp:18488 tcp:18488\n'
      }

      return oneDeviceWorld(cmd)
    })
    const runSelect: SelectPrompt = async () => 'http://localhost:8081'
    const { dependencies } = openDependencies(runCommand, { runSelect })

    await runDeviceOpen({}, dependencies)

    expect(commandsMatching(calls, '--list')).toHaveLength(1)
    expect(commandsMatching(calls, 'am').at(0)?.at(-1)).toBe('http://localhost:8081')
  })

  test('explains every port decision with --verbose', async () => {
    const existingReverse = (cmd: string[]) =>
      cmd.includes('--list') ? 'host-1 tcp:18488 tcp:9488\n' : oneDeviceWorld(cmd)

    const cases = [
      {
        expected: 'Resolved 8081 to http://localhost:8081',
        options: { url: '8081', verbose: true },
        world: oneDeviceWorld,
      },
      {
        expected: 'Not forwarding: disabled with --no-forward',
        options: { forward: false, url: 'http://localhost:8081', verbose: true },
        world: oneDeviceWorld,
      },
      {
        expected: 'Not forwarding: https://example.com/ does not name an explicit localhost port',
        options: { url: 'https://example.com/', verbose: true },
        world: oneDeviceWorld,
      },
      {
        expected: 'Keeping the existing reverse: device port 18488 to host port 9488',
        options: { url: 'http://localhost:18488/', verbose: true },
        world: existingReverse,
      },
    ]

    for (const { expected, options, world } of cases) {
      const { runCommand } = recordingRunner(world)
      const { dependencies, state } = openDependencies(runCommand)

      await runDeviceOpen(options, dependencies)

      expect(state.logs).toContain(expected)
    }
  })

  test('keeps the port decisions quiet without --verbose', async () => {
    const { runCommand } = recordingRunner(oneDeviceWorld)
    const { dependencies, state } = openDependencies(runCommand)

    await runDeviceOpen({ forward: false, url: '8081' }, dependencies)

    expect(state.logs.filter((line) => line.startsWith('Resolved') || line.startsWith('Not forwarding'))).toEqual([])
  })

  test('rejects a serial that is not connected and ready', async () => {
    // The failure path sets `process.exitCode`, which would otherwise fail the whole test run.
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const { dependencies, state } = openDependencies(runCommand)

    try {
      await runDeviceOpen({ device: 'OFFLINE1', url: '8081' }, dependencies)

      expect(state.cancelled).toContain('OFFLINE1')
      expect(commandsMatching(calls, 'am')).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('reports when no device is connected', async () => {
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = openDependencies(runCommand)

    try {
      await runDeviceOpen({ url: '8081' }, dependencies)

      expect(state.notes).toEqual(['No connected Android devices or emulators found'])
      expect(commandsMatching(calls, 'am')).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })
})

const FAKEWALLET_SHA256 = '550055426683c88aac246bef442bc8a37fe4986dca0b1ef475337dd7be6746e9'
const FAKEWALLET_TAG = '@solana-mobile/wallet-adapter-mobile@2.3.0'
const FAKEWALLET_URL = `https://github.com/solana-mobile/mobile-wallet-adapter/releases/download/${encodeURIComponent(FAKEWALLET_TAG)}/fakewallet-v1-release.apk`

describe('apk-catalog', () => {
  test('resolves fakewallet by name', () => {
    expect(findApkCatalogEntry('fakewallet')?.source.asset).toBe('fakewallet-v1-release.apk')
    expect(findApkCatalogEntry('nope')).toBeUndefined()
  })

  test('percent-encodes the release tag in the download URL', () => {
    const source = findApkCatalogEntry('fakewallet')?.source

    expect(source && githubReleaseDownloadUrl(source)).toBe(
      'https://github.com/solana-mobile/mobile-wallet-adapter/releases/download/%40solana-mobile%2Fwallet-adapter-mobile%402.3.0/fakewallet-v1-release.apk',
    )
  })
})

describe('resolveApkArgs', () => {
  const fakeFs = {
    listDirectory: async () => ['b.apk', 'notes.txt', 'a.apk'],
    pathKind: async (path: string): Promise<PathKind> =>
      path === 'builds' || path === 'empty' ? 'directory' : path.endsWith('.apk') ? 'file' : undefined,
  }

  test('keeps an existing file as-is', async () => {
    expect(await resolveApkArgs(['app.apk'], fakeFs)).toEqual([{ kind: 'local', path: 'app.apk' }])
  })

  test('expands a directory to its .apk files, sorted', async () => {
    expect(await resolveApkArgs(['builds'], fakeFs)).toEqual([
      { kind: 'local', path: 'builds/a.apk' },
      { kind: 'local', path: 'builds/b.apk' },
    ])
  })

  test('rejects a directory without .apk files', async () => {
    const emptyFs = { ...fakeFs, listDirectory: async () => ['notes.txt'] }

    await expect(resolveApkArgs(['empty'], emptyFs)).rejects.toThrow('No .apk files found in directory: empty')
  })

  test('resolves a catalog name when nothing exists on disk', async () => {
    const items = await resolveApkArgs(['fakewallet'], fakeFs)
    const item = items[0]

    expect(items).toHaveLength(1)
    expect(item?.kind === 'catalog' && item.entry.name).toBe('fakewallet')
  })

  test('rejects an unknown name and lists the catalog', async () => {
    await expect(resolveApkArgs(['fakewalet'], fakeFs)).rejects.toThrow(
      'Not a file, directory, or catalog APK: fakewalet\nCatalog APKs: fakewallet',
    )
  })
})

describe('installApk', () => {
  test('builds the adb install command with -r and the optional flags', () => {
    expect(buildAdbInstallCommand('SER1', 'app.apk')).toEqual(['adb', '-s', 'SER1', 'install', '-r', 'app.apk'])
    expect(buildAdbInstallCommand('SER1', 'app.apk', { downgrade: true, grant: true })).toEqual([
      'adb',
      '-s',
      'SER1',
      'install',
      '-r',
      '-d',
      '-g',
      'app.apk',
    ])
  })

  test('extracts the bare failure reason', () => {
    expect(extractAdbInstallFailure('Performing Streamed Install\nFailure [INSTALL_FAILED_TEST]')).toBe(
      'INSTALL_FAILED_TEST',
    )
    expect(extractAdbInstallFailure('Success')).toBeUndefined()
  })

  test('resolves on Success output', async () => {
    const { runCommand } = recordingRunner(() => 'Performing Streamed Install\nSuccess\n')

    await expect(installApk('SER1', 'app.apk', {}, { runCommand })).resolves.toBeUndefined()
  })

  test('throws the reason when adb exits zero but reports Failure', async () => {
    const { runCommand } = recordingRunner(() => 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]')

    await expect(installApk('SER1', 'app.apk', {}, { runCommand })).rejects.toThrow('INSTALL_FAILED_VERSION_DOWNGRADE')
  })

  test('throws the reason extracted from a rejecting adb', async () => {
    const { runCommand } = recordingRunner(() => {
      throw new Error('adb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')
    })

    await expect(installApk('SER1', 'app.apk', {}, { runCommand })).rejects.toThrow(
      'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
    )
  })
})

describe('ensureApkDownloaded', () => {
  const entry = {
    description: 'Mobile Wallet Adapter test wallet',
    name: 'fakewallet',
    source: {
      asset: 'fakewallet-v1-release.apk',
      repo: 'solana-mobile/mobile-wallet-adapter',
      sha256: FAKEWALLET_SHA256,
      tag: FAKEWALLET_TAG,
      type: 'github-release' as const,
    },
  }
  const cachedPath = `/cache/fakewallet/${encodeURIComponent(FAKEWALLET_TAG)}/fakewallet-v1-release.apk`

  test('skips the download when the pinned asset is cached', async () => {
    const downloads: string[] = []
    const result = await ensureApkDownloaded(
      entry,
      {},
      {
        downloadFile: async (url) => {
          downloads.push(url)
        },
        fileExists: async () => true,
        getCacheDirectory: () => '/cache',
      },
    )

    expect(result).toEqual({ downloaded: false, path: cachedPath })
    expect(downloads).toEqual([])
  })

  test('downloads into a tag-scoped cache path', async () => {
    const downloads: (string | undefined)[][] = []
    const result = await ensureApkDownloaded(
      entry,
      {},
      {
        downloadFile: async (url, destination, expectedSha256) => {
          downloads.push([url, destination, expectedSha256])
        },
        fileExists: async () => false,
        getCacheDirectory: () => '/cache',
      },
    )

    expect(result).toEqual({ downloaded: true, path: cachedPath })
    expect(downloads).toEqual([[FAKEWALLET_URL, cachedPath, FAKEWALLET_SHA256]])
  })

  test('re-downloads with force even when cached', async () => {
    const downloads: string[] = []

    await ensureApkDownloaded(
      entry,
      { force: true },
      {
        downloadFile: async (url) => {
          downloads.push(url)
        },
        fileExists: async () => true,
        getCacheDirectory: () => '/cache',
      },
    )

    expect(downloads).toEqual([FAKEWALLET_URL])
  })
})

describe('defaultDownloadFile', () => {
  const apkBytes = Buffer.from('not really an apk')
  const apkSha256 = createHash('sha256').update(apkBytes).digest('hex')

  async function withStubbedFetch(fn: (destination: string) => Promise<void>) {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'solana-mobile-apk-test-'))

    globalThis.fetch = (async () => new Response(apkBytes)) as unknown as typeof fetch

    try {
      await fn(join(directory, 'app.apk'))
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { force: true, recursive: true })
    }
  }

  test('writes the file when the digest matches', async () => {
    await withStubbedFetch(async (destination) => {
      await defaultDownloadFile('https://example.com/app.apk', destination, apkSha256)

      expect(await readFile(destination)).toEqual(apkBytes)
    })
  })

  test('rejects a digest mismatch without creating a cache entry', async () => {
    await withStubbedFetch(async (destination) => {
      await expect(defaultDownloadFile('https://example.com/app.apk', destination, 'f'.repeat(64))).rejects.toThrow(
        'SHA-256 verification',
      )

      await expect(stat(destination)).rejects.toThrow()
      await expect(stat(`${destination}.partial`)).rejects.toThrow()
    })
  })
})

describe('runDeviceInstall', () => {
  const singleDeviceWorld = (cmd: string[]): string => {
    if (cmd[1] === 'devices') {
      return 'List of devices attached\nSM02E4072816572\tdevice\n'
    }

    return defaultResponses(cmd)
  }

  function installDependencies(
    runCommand: CommandRunner,
    overrides: {
      fileExists?: (path: string) => Promise<boolean>
      runMultiselect?: MultiSelectPrompt
      runSelect?: SelectPrompt
    } = {},
  ) {
    const state: {
      cancelled?: string
      downloads: string[][]
      logs: string[]
      notes: string[]
      outro?: string
    } = { downloads: [], logs: [], notes: [] }

    return {
      dependencies: {
        cancel: (message: string) => {
          state.cancelled = message
        },
        downloadFile: async (url: string, destination: string) => {
          state.downloads.push([url, destination])
        },
        fileExists: async () => false,
        getCacheDirectory: () => '/cache',
        intro: () => {},
        log: (message: string) => {
          state.logs.push(message)
        },
        note: (message: string, title?: string) => {
          state.notes.push(title ?? message)
        },
        outro: (message: string) => {
          state.outro = message
        },
        pathKind: async (path: string): Promise<PathKind> => (path.endsWith('.apk') ? 'file' : undefined),
        runCommand,
        ...overrides,
      },
      state,
    }
  }

  test('installs local APKs on the only connected device', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const { dependencies, state } = installDependencies(runCommand)

    await runDeviceInstall({ apks: ['app.apk', 'other.apk'] }, dependencies)

    expect(commandsMatching(calls, 'install')).toEqual([
      ['adb', '-s', 'SM02E4072816572', 'install', '-r', 'app.apk'],
      ['adb', '-s', 'SM02E4072816572', 'install', '-r', 'other.apk'],
    ])
    expect(state.outro).toBe('Installed 2 APKs')
  })

  test('downloads a catalog APK before installing it', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const { dependencies, state } = installDependencies(runCommand)
    const cachedPath = `/cache/fakewallet/${encodeURIComponent(FAKEWALLET_TAG)}/fakewallet-v1-release.apk`

    await runDeviceInstall({ apks: ['fakewallet'] }, dependencies)

    expect(state.downloads).toEqual([[FAKEWALLET_URL, cachedPath]])
    expect(commandsMatching(calls, 'install').at(0)?.at(-1)).toBe(cachedPath)
  })

  test('uses the cached catalog APK when present', async () => {
    const { runCommand } = recordingRunner(singleDeviceWorld)
    const { dependencies, state } = installDependencies(runCommand, { fileExists: async () => true })

    await runDeviceInstall({ apks: ['fakewallet'] }, dependencies)

    expect(state.downloads).toEqual([])
    expect(state.logs).toContain(`Using cached fakewallet (${FAKEWALLET_TAG})`)
  })

  test('prompts with the catalog when no arguments are given', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const runMultiselect: MultiSelectPrompt = async () => ['fakewallet']
    const { dependencies, state } = installDependencies(runCommand, { runMultiselect })

    await runDeviceInstall({}, dependencies)

    expect(state.downloads).toHaveLength(1)
    expect(commandsMatching(calls, 'install')).toHaveLength(1)
  })

  test('exits quietly when the catalog picker is cancelled', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const runMultiselect: MultiSelectPrompt = async () => Symbol('cancelled')
    const { dependencies, state } = installDependencies(runCommand, { runMultiselect })

    await runDeviceInstall({}, dependencies)

    expect(commandsMatching(calls, 'install')).toEqual([])
    expect(state.outro).toBeUndefined()
  })

  test('continues past a failed install and reports a summary', async () => {
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd.includes('bad.apk')) {
        throw new Error('adb: failed to install bad.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]')
      }

      return singleDeviceWorld(cmd)
    })
    const { dependencies, state } = installDependencies(runCommand)

    try {
      await runDeviceInstall({ apks: ['bad.apk', 'good.apk'] }, dependencies)

      expect(commandsMatching(calls, 'install')).toHaveLength(2)
      expect(state.logs).toContain('Failed to install bad.apk: INSTALL_FAILED_VERSION_DOWNGRADE')
      expect(state.notes).toContain('1 installed, 1 failed')
      expect(state.outro).toBe('1 installed, 1 failed')
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('installs on every connected device with --all', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const { dependencies } = installDependencies(runCommand)

    await runDeviceInstall({ all: true, apks: ['app.apk'] }, dependencies)

    expect(
      commandsMatching(calls, 'install')
        .map((cmd) => cmd[2])
        .sort(),
    ).toEqual(['SM02E4072816572', 'emulator-5554'])
  })

  test('maps --downgrade and --grant to adb flags', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const { dependencies } = installDependencies(runCommand)

    await runDeviceInstall({ apks: ['app.apk'], downgrade: true, grant: true }, dependencies)

    expect(commandsMatching(calls, 'install')).toEqual([
      ['adb', '-s', 'SM02E4072816572', 'install', '-r', '-d', '-g', 'app.apk'],
    ])
  })

  test('lists the catalog without touching adb', async () => {
    const { calls, runCommand } = recordingRunner(singleDeviceWorld)
    const { dependencies, state } = installDependencies(runCommand)

    await runDeviceInstall({ list: true }, dependencies)

    expect(calls).toEqual([])
    expect(state.notes).toEqual(['APK catalog'])
  })

  test('reports when no device is connected', async () => {
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = installDependencies(runCommand)

    try {
      await runDeviceInstall({ apks: ['app.apk'] }, dependencies)

      expect(state.notes).toEqual(['No connected Android devices or emulators found'])
      expect(commandsMatching(calls, 'install')).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })
})

describe('applyDeviceTweaks', () => {
  test('tunes a physical device without asking for emulator properties', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)

    const { applied, skipped } = await applyDeviceTweaks('SM02E4072816572', {}, { runCommand })

    expect(calls).toEqual(tweakCommands('SM02E4072816572'))
    expect(applied.map((tweak) => tweak.name)).toEqual(DEVICE_TWEAKS.map((tweak) => tweak.name))
    expect(skipped).toEqual([])
  })

  test('reports a rejected tweak as skipped and keeps going', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd.includes('locksettings')) {
        throw new Error('java.lang.SecurityException: Requires SET_AND_VERIFY_LOCKSCREEN_CREDENTIALS permission')
      }

      return defaultResponses(cmd)
    })

    const { applied, skipped } = await applyDeviceTweaks('SM02E4072816572', {}, { runCommand })

    expect(calls).toEqual(tweakCommands('SM02E4072816572'))
    expect(applied.map((tweak) => tweak.name)).not.toContain('lockscreen-off')
    expect(skipped.map(({ tweak }) => tweak.name)).toEqual(['lockscreen-off'])
    expect(skipped.at(0)?.reason).toContain('SET_AND_VERIFY_LOCKSCREEN_CREDENTIALS')
  })
})

describe('runDeviceTune', () => {
  test('tunes the only connected device', async () => {
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\nSM02E4072816572\tdevice\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = tuneDependencies(runCommand)

    await runDeviceTune({}, dependencies)

    expect(tweakCalls(calls)).toEqual(tweakCommands('SM02E4072816572'))
    expect(state.logs.at(0)).toBe('Using device: Seeker (SM02E4072816572)')
    expect(state.logs.at(1)).toContain('Tuned Seeker (SM02E4072816572)')
    expect(state.logs.at(1)).toContain('- animations-off: Disable window, transition, and animator animations')
    expect(state.outro).toBe('Tuned 1 device')
  })

  test('tunes every usable device with --all, leaving the offline one alone', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const { dependencies, state } = tuneDependencies(runCommand)

    await runDeviceTune({ all: true }, dependencies)

    expect([...new Set(tweakCalls(calls).map((cmd) => cmd[2]))]).toEqual(['emulator-5554', 'SM02E4072816572'])
    expect(state.outro).toBe('Tuned 2 devices')
  })

  test('tunes the device picked from the list when several are connected', async () => {
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const runSelect: SelectPrompt = async (options) => {
      expect(options.options.map(({ value }) => value)).toEqual(['emulator-5554', 'SM02E4072816572'])
      return 'emulator-5554'
    }
    const { dependencies, state } = tuneDependencies(runCommand, { runSelect })

    await runDeviceTune({}, dependencies)

    expect([...new Set(tweakCalls(calls).map((cmd) => cmd[2]))]).toEqual(['emulator-5554'])
    expect(state.outro).toBe('Tuned 1 device')
  })

  test('applies only the tweaks left selected in the picker', async () => {
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\nSM02E4072816572\tdevice\n' : defaultResponses(cmd),
    )
    const runMultiselect: MultiSelectPrompt = async ({ initialValues, options }) => {
      expect(initialValues).toEqual(DEVICE_TWEAKS.map((tweak) => tweak.name))
      expect(options.map(({ value }) => value)).toEqual(DEVICE_TWEAKS.map((tweak) => tweak.name))
      return ['animations-off']
    }
    const { dependencies, state } = tuneDependencies(runCommand, { runMultiselect })

    await runDeviceTune({}, dependencies)

    expect(tweakCalls(calls)).toEqual(tweakCommands('SM02E4072816572', 'animations-off'))
    expect(state.logs.at(1)).toBe(
      'Tuned Seeker (SM02E4072816572)\n- animations-off: Disable window, transition, and animator animations',
    )
    expect(state.outro).toBe('Tuned 1 device')
  })

  test('applies every tweak without prompting with --yes', async () => {
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\nSM02E4072816572\tdevice\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = tuneDependencies(runCommand, {
      runMultiselect: async () => {
        throw new Error('The tweak picker must not open with --yes')
      },
    })

    await runDeviceTune({ yes: true }, dependencies)

    expect(tweakCalls(calls)).toEqual(tweakCommands('SM02E4072816572'))
    expect(state.cancelled).toBeUndefined()
    expect(state.outro).toBe('Tuned 1 device')
  })

  test('reports when every tweak is deselected', async () => {
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\nSM02E4072816572\tdevice\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = tuneDependencies(runCommand, { runMultiselect: async () => [] })

    await runDeviceTune({}, dependencies)

    expect(tweakCalls(calls)).toEqual([])
    expect(state.logs).toContain('No tweaks selected')
    expect(state.outro).toBe('Done')
  })

  test('exits quietly when the tweak picker is cancelled', async () => {
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\nSM02E4072816572\tdevice\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = tuneDependencies(runCommand, {
      runMultiselect: async () => Symbol('cancelled'),
    })

    await runDeviceTune({}, dependencies)

    expect(tweakCalls(calls)).toEqual([])
    expect(state.outro).toBeUndefined()
  })

  test('reports an unknown --device serial', async () => {
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner(defaultResponses)
    const { dependencies, state } = tuneDependencies(runCommand)

    try {
      await runDeviceTune({ device: 'NOPE' }, dependencies)

      expect(state.cancelled).toContain('Device not connected or not ready: NOPE')
      expect(tweakCalls(calls)).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('reports when no device is connected', async () => {
    const previousExitCode = process.exitCode
    const { calls, runCommand } = recordingRunner((cmd) =>
      cmd[1] === 'devices' ? 'List of devices attached\n' : defaultResponses(cmd),
    )
    const { dependencies, state } = tuneDependencies(runCommand)

    try {
      await runDeviceTune({}, dependencies)

      expect(state.notes).toEqual(['No connected Android devices or emulators found'])
      expect(tweakCalls(calls)).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
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

describe('device command', () => {
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
})

describe('adb primitives', () => {
  test('parses emulators and physical devices with their states, sorted by serial', () => {
    const devices = parseAdbDevices(
      [
        '* daemon not running; starting now at tcp:5037',
        '* daemon started successfully',
        'List of devices attached',
        'emulator-5554\tdevice',
        '39281FDJH00KL2\tdevice',
        'ZY22G9WXYZ\tunauthorized',
        'R5CT10ABCDE\toffline',
        '',
      ].join('\n'),
    )

    // Sorted with localeCompare, matching listRunningEmulators, so case does not split the list.
    expect(devices).toEqual([
      { serial: '39281FDJH00KL2', state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R5CT10ABCDE', state: 'offline' },
      { serial: 'ZY22G9WXYZ', state: 'unauthorized' },
    ] satisfies AdbDevice[])
  })

  test('reads reverses as device port then host port', () => {
    // Verified against a live device: `adb reverse tcp:8899 tcp:9899` lists as `host-14 tcp:8899 tcp:9899`.
    expect(parseAdbReverses(['host-14 tcp:8081 tcp:8081', 'host-14 tcp:8899 tcp:9899', ''].join('\n'))).toEqual([
      { devicePort: 8081, hostPort: 8081 },
      { devicePort: 8899, hostPort: 9899 },
    ])
  })

  test('reads reverses whatever the transport is labelled', () => {
    // A USB-attached phone labels the transport `UsbFfs` rather than `host-NN` (seen on a Seeker).
    expect(parseAdbReverses(['UsbFfs tcp:8899 tcp:8899', 'UsbFfs tcp:18488 tcp:18488'].join('\n'))).toEqual([
      { devicePort: 8899, hostPort: 8899 },
      { devicePort: 18488, hostPort: 18488 },
    ])
  })

  test('parses a physical device serial alongside an emulator', () => {
    expect(parseAdbDevices('List of devices attached\nSM02E4072816572\tdevice\nemulator-5554\tdevice\n')).toEqual([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'SM02E4072816572', state: 'device' },
    ])
  })

  test('parses wireless adb serials', () => {
    expect(
      parseAdbDevices(
        [
          'List of devices attached',
          '192.168.1.42:37013\tdevice',
          'adb-R5CT10ABCDE-Kj8Xq2._adb-tls-connect._tcp\tdevice',
        ].join('\n'),
      ).map(({ serial }) => serial),
    ).toEqual(['192.168.1.42:37013', 'adb-R5CT10ABCDE-Kj8Xq2._adb-tls-connect._tcp'])
  })

  test('ignores reverse lines that are not tcp', () => {
    expect(
      parseAdbReverses(['host-14 localabstract:foo localabstract:bar', 'host-14 tcp:8899 tcp:8899'].join('\n')),
    ).toEqual([{ devicePort: 8899, hostPort: 8899 }])
  })

  test('parses tcp port specs', () => {
    expect(parseTcpPort('tcp:8899')).toBe(8899)
    expect(parseTcpPort('localabstract:x')).toBeUndefined()
    expect(parseTcpPort('tcp:not-a-port')).toBeUndefined()
    expect(parseTcpPort(undefined)).toBeUndefined()
  })
})
