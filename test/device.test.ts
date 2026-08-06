import { describe, expect, test } from 'bun:test'
import type { CommandRunner } from '../src/core/data-access/command-types.ts'
import { listConnectedDevices } from '../src/device/data-access/list-connected-devices.ts'
import { localhostPort, resolveOpenUrl, validateOpenUrlInput } from '../src/device/data-access/resolve-open-url.ts'
import { runDeviceOpen } from '../src/device/device-feature-open.ts'
import { describeReverse } from '../src/device/ui/device-ui-messages.ts'
import { selectOpenUrl } from '../src/device/ui/device-ui-select-open-url.ts'
import type { SelectPrompt, TextPrompt } from '../src/emulator/ui/emulator-ui-prompt-types.ts'

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

    await runDeviceOpen({ url: 'https://solanamobile.com' }, dependencies)

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

    await runDeviceOpen({ url: 'https://solanamobile.com' }, dependencies)

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
        expected: 'Not forwarding: https://solanamobile.com/ does not name an explicit localhost port',
        options: { url: 'https://solanamobile.com/', verbose: true },
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
