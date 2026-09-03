import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import type { CommandRunner } from '../src/core/data-access/command-types.ts'
import { runExecutable } from '../src/core/data-access/run-executable.ts'
import { parseAdbReverses, parseTcpPort } from '../src/localnet/data-access/adb-reverse.ts'
import { syncForwards } from '../src/localnet/data-access/apply-forwards.ts'
import {
  buildDockerRunCommand,
  isManagedContainer,
  parseContainerStatus,
  parsePublishedPorts,
} from '../src/localnet/data-access/docker-engine.ts'
import { parseAdbDevices } from '../src/localnet/data-access/list-adb-devices.ts'
import {
  localnetDeviceRpcUrl,
  localnetEndpoints,
  localnetRpcUrl,
  parseLocalnetEngineId,
  planEngineAction,
  resolveLocalnet,
  resolveLocalnetForContainer,
} from '../src/localnet/data-access/localnet-engines.ts'
import type {
  AdbDevice,
  AdbReverseEntry,
  LocalnetForwardCommandOptions,
  LocalnetStartCommandOptions,
  LocalnetStatusCommandOptions,
  LocalnetStopCommandOptions,
  OwnedForward,
  ResolvedLocalnetPort,
} from '../src/localnet/data-access/localnet-types.ts'
import {
  clearOwnedForwards,
  mergeOwnedForwards,
  parseOwnedForwards,
  readOwnedForwards,
  writeOwnedForwards,
} from '../src/localnet/data-access/owned-forwards-store.ts'
import {
  matchReverse,
  ownedForwards,
  pendingForwards,
  planForwards,
  planRemovals,
} from '../src/localnet/data-access/plan-forwards.ts'
import { parseProbeExitCode, probeDevicePort } from '../src/localnet/data-access/probe-device-port.ts'
import { probeRpc } from '../src/localnet/data-access/probe-rpc.ts'
import { waitForAbort } from '../src/localnet/data-access/watch-forwards.ts'
import { createLocalnetCommand } from '../src/localnet/localnet-feature.ts'
import { createLocalnetCheckReport } from '../src/localnet/localnet-feature-check.ts'
import { runLocalnetStart } from '../src/localnet/localnet-feature-start.ts'
import { createLocalnetStatusReport } from '../src/localnet/localnet-feature-status.ts'
import { removeLocalnetForwards, runLocalnetStop } from '../src/localnet/localnet-feature-stop.ts'
import { endpointsMessage } from '../src/localnet/ui/localnet-ui-messages.ts'

const SURFPOOL_PORTS: ResolvedLocalnetPort[] = [
  { canonical: 8899, host: 8899, name: 'rpc' },
  { canonical: 8900, host: 8900, name: 'ws' },
  { canonical: 18488, host: 18488, name: 'studio' },
]

/** Records every command so tests can assert on what adb was actually asked to do. */
function recordingRunner(responses: (cmd: string[]) => string): { calls: string[][]; runCommand: CommandRunner } {
  const calls: string[][] = []
  const runCommand: CommandRunner = async (cmd) => {
    calls.push([...cmd])
    return responses([...cmd])
  }

  return { calls, runCommand }
}

function existingMap(entries: Record<string, AdbReverseEntry[]>): Map<string, AdbReverseEntry[]> {
  return new Map(Object.entries(entries))
}

const alwaysReachable = async () => ({ result: 'ok' })

/**
 * Silences the prompts a start run would print and captures the message it cancelled with, if any.
 *
 * The ownership store is stubbed in memory by default: the real one writes to the developer's home
 * directory, and a test suite has no business touching it.
 */
function startDependencies(runCommand: CommandRunner, fetchJsonRpc: () => Promise<unknown>) {
  const state: { cancelled?: string; notes: string[]; stored: OwnedForward[] | undefined } = {
    notes: [],
    stored: undefined,
  }

  return {
    dependencies: {
      cancel: (message: string) => {
        state.cancelled = message
      },
      fetchJsonRpc,
      intro: () => {},
      log: () => {},
      note: (message: string) => {
        state.notes.push(message)
      },
      outro: () => {},
      readOwnedForwards: async () => state.stored,
      runCommand,
      spinner: (() => ({ error: () => {}, message: () => {}, start: () => {}, stop: () => {} })) as never,
      writeOwnedForwards: async (forwards: readonly OwnedForward[]) => {
        state.stored = [...forwards]
      },
    },
    state,
  }
}

describe('localnet review fixes', () => {
  const worldWithoutContainer = (cmd: string[]) => {
    if (cmd[1] === 'inspect') throw new Error('No such object: solana-mobile-localnet')
    if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
    if (cmd.includes('--list')) return 'host-1 tcp:8900 tcp:8900\n'
    return ''
  }

  test('publishes container ports on loopback only', () => {
    // `host:container` binds every interface, which would put the validator's RPC on the LAN.
    const command = buildDockerRunCommand(resolveLocalnet('surfpool')).join(' ')

    expect(command).toContain('--publish 127.0.0.1:8899:8899')
    expect(command).not.toContain('--publish 8899:8899')
  })

  test('records what a detached session claims, even with no container of ours', async () => {
    // The gap the container label could not close: `--detach` may attach to a validator someone else is
    // running, and that path still tells the user to clean up with `localnet stop`.
    const { calls, runCommand } = recordingRunner(worldWithoutContainer)
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    await runLocalnetStart({ detach: true }, dependencies)

    // Attached, so no container was created — yet ownership is still recorded.
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')).toBe(false)
    // 8900 already pointed where it should, so only 8899 and 18488 are claimed.
    expect(state.stored).toEqual([
      { devicePort: 8899, serial: 'emulator-5554' },
      { devicePort: 18488, serial: 'emulator-5554' },
    ])
  })

  test('keeps the earlier claim when start --detach runs twice, so stop still cleans up', async () => {
    // Regression guard: the second run finds every reverse already correct, applies nothing, and used to
    // overwrite the first run's record with `[]` — a positive claim of owning nothing, after which `stop`
    // removed the container and left the reverses behind.
    const live = new Map<number, number>()
    const removed: string[] = []
    const runCommand: CommandRunner = async (cmd) => {
      if (cmd[1] === 'inspect') throw new Error('No such object: solana-mobile-localnet')
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) {
        return [...live].map(([device, host]) => `host-1 tcp:${device} tcp:${host}\n`).join('')
      }
      if (cmd.includes('--remove')) {
        const port = Number((cmd[cmd.length - 1] as string).slice('tcp:'.length))

        live.delete(port)
        removed.push(cmd[cmd.length - 1] as string)
        return ''
      }
      if (cmd.includes('reverse')) {
        live.set(
          Number((cmd[cmd.length - 2] as string).slice('tcp:'.length)),
          Number((cmd[cmd.length - 1] as string).slice('tcp:'.length)),
        )
      }
      return ''
    }
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    await runLocalnetStart({ detach: true }, dependencies)
    const afterFirst = state.stored
    await runLocalnetStart({ detach: true }, dependencies)

    // Second run applied nothing, but the claim has to survive it.
    expect(state.stored).toEqual(afterFirst)
    expect(state.stored).toHaveLength(3)

    await runLocalnetStop(
      {},
      {
        cancel: () => {},
        clearOwnedForwards: async () => {},
        intro: () => {},
        log: () => {},
        outro: () => {},
        readOwnedForwards: async () => state.stored,
        runCommand,
      },
    )

    expect(removed.sort()).toEqual(['tcp:18488', 'tcp:8899', 'tcp:8900'])
    expect(live.size).toBe(0)
  })

  test('rolls back reverses already applied when a later one throws', async () => {
    // Regression guard: ownership used to be recorded only after `syncForwards` returned, so a failure
    // part-way through left the earlier reverses on the device with nothing tracking them.
    const removed: string[] = []
    // Stateful, so a created reverse actually shows up in `--list` afterwards — teardown only removes
    // reverses that exist, so a stub that always reports none would hide the very leak being tested.
    const live = new Set<number>()
    let created = 0
    const runCommand: CommandRunner = async (cmd) => {
      if (cmd[1] === 'inspect') throw new Error('No such object: solana-mobile-localnet')
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return [...live].map((port) => `host-1 tcp:${port} tcp:${port}\n`).join('')
      if (cmd.includes('--remove')) {
        const port = Number((cmd[cmd.length - 1] as string).slice('tcp:'.length))

        live.delete(port)
        removed.push(cmd[cmd.length - 1] as string)
        return ''
      }
      if (cmd.includes('reverse')) {
        created += 1
        if (created === 2) throw new Error('adb: device offline')
        live.add(Number((cmd[cmd.length - 2] as string).slice('tcp:'.length)))
        return ''
      }
      return ''
    }
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)
    const previousExitCode = process.exitCode

    try {
      await runLocalnetStart({ detach: true }, dependencies)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }

    expect(state.cancelled).toBeDefined()
    // The first reverse landed before the second threw, so it has to be taken back down.
    expect(removed).toEqual(['tcp:8899'])
  })

  test('removes an owned container when a later step fails', async () => {
    // Regression guard: `docker run` could succeed and readiness still fail, orphaning the container.
    let inspected = 0
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') {
        inspected += 1
        if (inspected === 1) throw new Error('No such object: solana-mobile-localnet')
        return 'exited|none|surfpool||'
      }
      return worldWithoutContainer(cmd)
    })
    const { dependencies, state } = startDependencies(runCommand, async () => {
      throw new Error('Unable to connect')
    })

    // The failure path sets `process.exitCode`, which would otherwise fail the whole test run.
    const previousExitCode = process.exitCode

    try {
      await runLocalnetStart({ detach: true }, dependencies)
    } finally {
      // `?? 0` because assigning `undefined` back does not clear an exit code already set to 1.
      process.exitCode = previousExitCode ?? 0
    }

    expect(state.cancelled).toBeDefined()
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')).toBe(true)
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'rm')).toBe(true)
  })

  test('does not claim to be watching in detached mode', async () => {
    const { runCommand } = recordingRunner(worldWithoutContainer)
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    // `watch` defaults to true, but a detached run exits and cannot reconcile anything.
    await runLocalnetStart({ detach: true, watch: true }, dependencies)

    expect(state.notes.join('\n')).not.toContain('Watching for devices')
    expect(state.notes.join('\n')).toContain('Forwards are applied once')
  })

  test('stop removes only the forwards the detached session recorded', async () => {
    const removed: string[] = []
    let cleared = false
    const runCommand: CommandRunner = async (cmd) => {
      if (cmd[1] === 'inspect') return 'running|healthy|surfpool|{"8899/tcp":[{"HostPort":"8899"}]}'
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return 'host-1 tcp:8899 tcp:8899\nhost-1 tcp:8900 tcp:8900\n'
      if (cmd.includes('--remove')) removed.push(cmd[cmd.length - 1] as string)
      return ''
    }

    await runLocalnetStop(
      {},
      {
        cancel: () => {},
        clearOwnedForwards: async () => {
          cleared = true
        },
        intro: () => {},
        log: () => {},
        outro: () => {},
        readOwnedForwards: async () => [{ devicePort: 8899, serial: 'emulator-5554' }],
        runCommand,
      },
    )

    // 8900 is on a canonical port but was never claimed, so it belongs to whoever created it.
    expect(removed).toEqual(['tcp:8899'])
    expect(cleared).toBe(true)
  })

  test('stop falls back to the port set when no ownership was recorded', async () => {
    const removed: string[] = []
    const runCommand: CommandRunner = async (cmd) => {
      if (cmd[1] === 'inspect') return 'running|healthy|surfpool|{"8899/tcp":[{"HostPort":"8899"}]}'
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return 'host-1 tcp:8081 tcp:8081\nhost-1 tcp:8899 tcp:8899\n'
      if (cmd.includes('--remove')) removed.push(cmd[cmd.length - 1] as string)
      return ''
    }

    await runLocalnetStop(
      {},
      {
        cancel: () => {},
        clearOwnedForwards: async () => {},
        intro: () => {},
        log: () => {},
        outro: () => {},
        // No record: an older session, so ownership is unknown.
        readOwnedForwards: async () => undefined,
        runCommand,
      },
    )

    // Unrelated forwards such as Metro on 8081 still survive the fallback.
    expect(removed).toEqual(['tcp:8899'])
  })

  test('merges ownership claims without duplicating them', () => {
    expect(
      mergeOwnedForwards(
        [
          { devicePort: 8899, serial: 'emulator-5554' },
          { devicePort: 8900, serial: 'emulator-5554' },
        ],
        [{ devicePort: 8899, serial: 'emulator-5554' }],
        [{ devicePort: 8899, serial: 'SM02E4072816572' }],
      ),
    ).toEqual([
      { devicePort: 8899, serial: 'emulator-5554' },
      { devicePort: 8900, serial: 'emulator-5554' },
      { devicePort: 8899, serial: 'SM02E4072816572' },
    ])
  })

  test('round trips the ownership record through the store', async () => {
    const files = new Map<string, string>()
    const deps = {
      getHomeDirectory: () => '/home/test',
      readTextFile: async (path: string) => {
        const contents = files.get(path)
        if (contents === undefined) throw new Error('ENOENT')
        return contents
      },
      removeFile: async (path: string) => {
        files.delete(path)
      },
      writeTextFile: async (path: string, contents: string) => {
        files.set(path, contents)
      },
    }

    expect(await readOwnedForwards(deps)).toBeUndefined()

    await writeOwnedForwards([{ devicePort: 8899, serial: 'emulator-5554' }], deps)
    expect(await readOwnedForwards(deps)).toEqual([{ devicePort: 8899, serial: 'emulator-5554' }])

    await clearOwnedForwards(deps)
    expect(await readOwnedForwards(deps)).toBeUndefined()
  })

  test('reads back recorded forwards, and treats a missing record as unknown', () => {
    expect(parseOwnedForwards('[{"devicePort":8899,"serial":"emulator-5554"}]')).toEqual([
      { devicePort: 8899, serial: 'emulator-5554' },
    ])
    // Unknown ownership must not be mistaken for "owned nothing".
    expect(parseOwnedForwards('')).toBeUndefined()
    expect(parseOwnedForwards('not json')).toBeUndefined()
  })

  test('returns stderr as well as stdout when asked to combine', async () => {
    // `docker logs` writes container stderr separately; dropping it hides validator diagnostics.
    const cmd: [string, ...string[]] = ['sh', '-c', 'printf out; printf err 1>&2']

    expect(await runExecutable(cmd)).toBe('out')
    expect(await runExecutable(cmd, { combineOutput: true })).toBe('outerr')
  })
})

describe('localnet parsing', () => {
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

  test('reads container status and engine label', () => {
    expect(parseContainerStatus('running|healthy|surfpool')).toEqual({
      engine: 'surfpool',
      health: 'healthy',
      name: 'solana-mobile-localnet',
      running: true,
      status: 'running',
    })
    expect(parseContainerStatus('exited|none|<no value>')).toEqual({
      engine: undefined,
      health: undefined,
      name: 'solana-mobile-localnet',
      running: false,
      status: 'exited',
    })
  })

  test('reads the probe exit code from the last line of output', () => {
    expect(parseProbeExitCode('0\n')).toBe(0)
    expect(parseProbeExitCode('some warning\n1\n')).toBe(1)
    expect(parseProbeExitCode('garbage')).toBeUndefined()
  })
})

describe('localnet engines', () => {
  test('keeps canonical ports fixed when the host port is overridden', () => {
    const localnet = resolveLocalnet('surfpool', { ports: { port: 9899 } })
    const rpc = localnet.ports.find(({ name }) => name === 'rpc')

    // The device keeps seeing 8899 so app configuration never moves.
    expect(rpc).toEqual({ canonical: 8899, host: 9899, name: 'rpc' })
    expect(localnetDeviceRpcUrl(localnet)).toBe('http://localhost:8899')
    expect(localnetRpcUrl(localnet)).toBe('http://localhost:9899')
  })

  test('builds the surfpool container command with canonical ports and host publishing', () => {
    expect(buildDockerRunCommand(resolveLocalnet('surfpool', { ports: { port: 9899 } })).join(' ')).toBe(
      [
        'docker run --detach --name solana-mobile-localnet',
        '--label localnet.engine=surfpool',
        '--env SURFPOOL_NETWORK_HOST=0.0.0.0',
        // Loopback-bound: `host:container` would publish the validator on every interface.
        '--publish 127.0.0.1:9899:8899 --publish 127.0.0.1:8900:8900 --publish 127.0.0.1:18488:18488',
        'surfpool/surfpool:latest',
        'start --no-tui --host 0.0.0.0 --port 8899 --ws-port 8900 --studio-port 18488 --offline',
      ].join(' '),
    )
  })

  test('runs the test-validator image in privileged mode', () => {
    const command = buildDockerRunCommand(resolveLocalnet('test-validator'))

    expect(command).toContain('--privileged')
    expect(command).toContain('beeman/solana-test-validator:latest')
  })

  test('honours an image override', () => {
    expect(buildDockerRunCommand(resolveLocalnet('surfpool', { image: 'ghcr.io/example/surfpool:pinned' }))).toContain(
      'ghcr.io/example/surfpool:pinned',
    )
  })

  test('rejects unknown engines', () => {
    expect(parseLocalnetEngineId('surfpool')).toBe('surfpool')
    expect(() => parseLocalnetEngineId('geyser')).toThrow('Unknown localnet engine: geyser')
  })
})

describe('localnet engine action', () => {
  test('starts a container when nothing is serving the ports', () => {
    expect(planEngineAction({ containerRunning: false, rpcReachable: false })).toBe('start')
  })

  test('attaches to a validator someone else is already running', () => {
    expect(planEngineAction({ containerRunning: false, rpcReachable: true })).toBe('attach')
  })

  test('prefers our own running container over attaching', () => {
    // When our container is up, the RPC answering is that container rather than a third party.
    expect(planEngineAction({ containerRunning: true, rpcReachable: true })).toBe('reuse')
  })
})

describe('localnet start', () => {
  /** No container of ours, one usable device, one existing rpc reverse. */
  const worldWithoutContainer = (cmd: string[]) => {
    if (cmd[1] === 'inspect') throw new Error('No such object: solana-mobile-localnet')
    if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
    if (cmd.includes('--list')) return 'host-1 tcp:8899 tcp:8899\n'
    return ''
  }
  test('does not start a container when a validator already serves the ports', async () => {
    const { calls, runCommand } = recordingRunner(worldWithoutContainer)
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    await runLocalnetStart({ detach: true }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')).toBe(false)
    // Attaching must not require Docker, so it never asks whether Docker is running. `docker inspect`
    // is still attempted, but failing it just means "no container of ours".
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'info')).toBe(false)
  })

  test('starts a container when nothing answers on the ports', async () => {
    const { calls, runCommand } = recordingRunner(worldWithoutContainer)
    let attempt = 0
    // Unreachable on the pre-flight probe, reachable once the container is up.
    const { dependencies, state } = startDependencies(runCommand, async () => {
      attempt += 1
      if (attempt === 1) throw new Error('Unable to connect')
      return { result: 'ok' }
    })

    await runLocalnetStart({ detach: true }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')).toBe(true)
  })

  test('leaves an attached validator and its container alone on teardown', async () => {
    const controller = new AbortController()
    const { calls, runCommand } = recordingRunner(worldWithoutContainer)
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    controller.abort()
    await runLocalnetStart({}, { ...dependencies, signal: controller.signal })

    expect(state.cancelled).toBeUndefined()
    // A validator we did not start is not ours to stop. 8899 was already pointing where it should when
    // we arrived, so it is not ours to remove either — see the ownership test below.
    expect(calls.some((cmd) => cmd.includes('--remove') && cmd.includes('tcp:8899'))).toBe(false)
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'rm')).toBe(false)
  })

  test('removes on teardown only the reverses the session created', async () => {
    // Regression guard: ownership used to be inferred from the port number alone, so Ctrl-C deleted every
    // reverse on a canonical port — including one that was already correct and belonged to someone else.
    const controller = new AbortController()
    // Pre-existing and already correct, so the plan classifies it as `keep`.
    const reverses = new Map<number, number>([[8899, 8899]])
    const { runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') throw new Error('No such object: solana-mobile-localnet')
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) {
        return [...reverses].map(([devicePort, hostPort]) => `host-1 tcp:${devicePort} tcp:${hostPort}`).join('\n')
      }

      if (cmd.includes('--remove')) {
        reverses.delete(parseTcpPort(cmd[5]) as number)
      } else if (cmd[3] === 'reverse') {
        reverses.set(parseTcpPort(cmd[4]) as number, parseTcpPort(cmd[5]) as number)
      }

      return ''
    })
    const { dependencies, state } = startDependencies(runCommand, alwaysReachable)

    controller.abort()
    await runLocalnetStart({}, { ...dependencies, signal: controller.signal })

    expect(state.cancelled).toBeUndefined()
    // The two it created are gone; the one it found is untouched.
    expect([...reverses]).toEqual([[8899, 8899]])
  })
})

describe('localnet forward planning', () => {
  const devices: AdbDevice[] = [
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'ZY22G9WXYZ', state: 'unauthorized' },
  ]

  test('creates missing forwards and keeps matching ones', () => {
    const actions = planForwards({
      devices,
      existing: existingMap({ 'emulator-5554': [{ devicePort: 8899, hostPort: 8899 }] }),
      ports: SURFPOOL_PORTS,
    })

    expect(actions.map(({ kind, name }) => `${name}:${kind}`)).toEqual(['rpc:keep', 'ws:create', 'studio:create'])
    // Unusable devices are reported by the renderer, never forwarded to.
    expect(actions.every(({ serial }) => serial === 'emulator-5554')).toBe(true)
  })

  test('replaces a forward pointing at the wrong host port', () => {
    const actions = planForwards({
      devices: [{ serial: 'emulator-5554', state: 'device' }],
      existing: existingMap({ 'emulator-5554': [{ devicePort: 8899, hostPort: 7777 }] }),
      ports: SURFPOOL_PORTS,
    })

    expect(actions.find(({ name }) => name === 'rpc')?.kind).toBe('replace')
    expect(pendingForwards(actions)).toHaveLength(3)
  })

  test('plans nothing when every forward is already correct', () => {
    const actions = planForwards({
      devices: [{ serial: 'emulator-5554', state: 'device' }],
      existing: existingMap({
        'emulator-5554': SURFPOOL_PORTS.map(({ canonical, host }) => ({ devicePort: canonical, hostPort: host })),
      }),
      ports: SURFPOOL_PORTS,
    })

    expect(pendingForwards(actions)).toEqual([])
  })

  test('only ever plans removal of ports the engine owns', () => {
    // Regression guard: developers keep Metro on 8081, and `adb reverse --remove-all` would break it.
    const removals = planRemovals({
      existing: existingMap({
        'emulator-5554': [
          { devicePort: 8081, hostPort: 8081 },
          { devicePort: 8899, hostPort: 8899 },
          { devicePort: 18488, hostPort: 18488 },
        ],
      }),
      ports: SURFPOOL_PORTS,
    })

    expect(removals).toEqual([
      { devicePort: 8899, serial: 'emulator-5554' },
      { devicePort: 18488, serial: 'emulator-5554' },
    ])
  })
})

describe('localnet forward application', () => {
  test('issues reverse commands only for missing forwards', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return 'host-14 tcp:8899 tcp:8899\n'
      return ''
    })

    const result = await syncForwards({ ports: SURFPOOL_PORTS }, { runCommand })

    expect(result.applied.map(({ name }) => name)).toEqual(['ws', 'studio'])
    expect(calls.filter((cmd) => cmd.includes('reverse') && !cmd.includes('--list'))).toEqual([
      ['adb', '-s', 'emulator-5554', 'reverse', 'tcp:8900', 'tcp:8900'],
      ['adb', '-s', 'emulator-5554', 'reverse', 'tcp:18488', 'tcp:18488'],
    ])
  })

  test('removes a stale forward before recreating it', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return 'host-14 tcp:8899 tcp:7777\n'
      return ''
    })

    await syncForwards({ ports: [SURFPOOL_PORTS[0] as ResolvedLocalnetPort] }, { runCommand })

    expect(calls.filter((cmd) => cmd.includes('reverse') && !cmd.includes('--list'))).toEqual([
      ['adb', '-s', 'emulator-5554', 'reverse', '--remove', 'tcp:8899'],
      ['adb', '-s', 'emulator-5554', 'reverse', 'tcp:8899', 'tcp:8899'],
    ])
  })

  test('restricts forwarding to the requested device', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n'
      return ''
    })

    await syncForwards(
      { devices: ['emulator-5556'], ports: [SURFPOOL_PORTS[0] as ResolvedLocalnetPort] },
      { runCommand },
    )

    expect(calls.some((cmd) => cmd.includes('emulator-5554'))).toBe(false)
    expect(calls).toContainEqual(['adb', '-s', 'emulator-5556', 'reverse', 'tcp:8899', 'tcp:8899'])
  })

  test('never removes reverses it does not own', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return ['host-14 tcp:8081 tcp:8081', 'host-14 tcp:8899 tcp:8899'].join('\n')
      return ''
    })

    const removed = await removeLocalnetForwards({ ports: SURFPOOL_PORTS }, { runCommand })

    expect(removed).toEqual([{ devicePort: 8899, serial: 'emulator-5554' }])
    expect(calls.some((cmd) => cmd.includes('tcp:8081'))).toBe(false)
    expect(calls.some((cmd) => cmd.includes('--remove-all'))).toBe(false)
  })
})

describe('localnet foreground hold', () => {
  test('keeps the event loop alive until aborted, then resolves', async () => {
    // Regression guard: a signal listener alone does not hold the Node event loop open, so the command
    // used to exit immediately and skip teardown, leaking the container and its forwards.
    const controller = new AbortController()
    let resolved = false
    const held = waitForAbort(controller.signal, { keepAliveMs: 50 }).then(() => {
      resolved = true
    })

    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(resolved).toBe(false)

    controller.abort()
    await held
    expect(resolved).toBe(true)
  })

  test('resolves immediately when the signal is already aborted', async () => {
    expect(await waitForAbort(AbortSignal.abort())).toBeUndefined()
  })
})

describe('localnet probes', () => {
  test('treats a successful connect as a registered reverse', async () => {
    const runCommand: CommandRunner = async () => '0\n'

    expect(await probeDevicePort('emulator-5554', SURFPOOL_PORTS[0] as ResolvedLocalnetPort, { runCommand })).toEqual({
      devicePort: 8899,
      name: 'rpc',
      ok: true,
    })
  })

  test('treats a refused connect as a missing reverse', async () => {
    const runCommand: CommandRunner = async () => '1\n'
    const result = await probeDevicePort('emulator-5554', SURFPOOL_PORTS[0] as ResolvedLocalnetPort, { runCommand })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Connection refused on device')
  })

  test('reports the host rpc version on success', async () => {
    const result = await probeRpc('http://localhost:8899', {
      fetchJsonRpc: async (_url, method) =>
        method === 'getHealth' ? { result: 'ok' } : { result: { 'solana-core': '4.1.2', 'surfnet-version': '1.5.0' } },
    })

    expect(result).toEqual({ ok: true, version: 'surfnet 1.5.0' })
  })

  test('reports a failing host rpc without throwing', async () => {
    const result = await probeRpc('http://localhost:8899', {
      fetchJsonRpc: async () => {
        throw new Error('Unable to connect')
      },
    })

    expect(result).toEqual({ error: 'Unable to connect', ok: false })
  })
})

describe('localnet check report', () => {
  const localnet = resolveLocalnet('surfpool')
  const reverseList = (entries: readonly AdbReverseEntry[]) =>
    entries.map(({ devicePort, hostPort }) => `host-1 tcp:${devicePort} tcp:${hostPort}`).join('\n')
  const correctReverses = SURFPOOL_PORTS.map(({ canonical, host }) => ({ devicePort: canonical, hostPort: host }))

  /** One usable device whose reverses all point where they should, and a probe that always connects. */
  function checkRunner(entries: readonly AdbReverseEntry[] = correctReverses) {
    return recordingRunner((cmd) => {
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return reverseList(entries)
      return '0\n'
    })
  }

  const { runCommand } = checkRunner()

  test('passes only when the host rpc and every device leg pass', async () => {
    const report = await createLocalnetCheckReport(
      localnet,
      {},
      { fetchJsonRpc: async () => ({ result: 'ok' }), runCommand },
    )

    expect(report.ok).toBe(true)
    expect(report.devices[0]?.ports.map(({ ok }) => ok)).toEqual([true, true, true])
  })

  test('fails when the validator is down even though every reverse is registered', async () => {
    // The device leg cannot detect a dead host: adbd accepts on the device listener regardless.
    const report = await createLocalnetCheckReport(
      localnet,
      {},
      {
        fetchJsonRpc: async () => {
          throw new Error('Unable to connect')
        },
        runCommand,
      },
    )

    expect(report.rpc.ok).toBe(false)
    expect(report.devices[0]?.ports.every(({ ok }) => ok)).toBe(true)
    expect(report.ok).toBe(false)
  })

  test('fails when no devices are connected', async () => {
    const report = await createLocalnetCheckReport(
      localnet,
      {},
      {
        fetchJsonRpc: async () => ({ result: 'ok' }),
        runCommand: async () => 'List of devices attached\n',
      },
    )

    expect(report.devices).toEqual([])
    expect(report.ok).toBe(false)
  })

  test('fails a device port whose reverse points at the wrong host port', async () => {
    // Regression guard: the device probe connects to any listener on the canonical port, so a reverse
    // aimed at a stale host port passed the device leg while the host leg passed at the expected URL —
    // reporting a healthy tunnel while the app was routed somewhere else.
    const { calls, runCommand } = checkRunner([{ devicePort: 8899, hostPort: 9000 }, ...correctReverses.slice(1)])

    const report = await createLocalnetCheckReport(
      localnet,
      {},
      { fetchJsonRpc: async () => ({ result: 'ok' }), runCommand },
    )

    expect(report.ok).toBe(false)
    expect(report.devices[0]?.ports[0]).toEqual({
      devicePort: 8899,
      hostPort: 8899,
      name: 'rpc',
      ok: false,
      reason: 'reverse points at host port 9000, expected 8899',
    })
    // The mapping is already known to be wrong, so there is nothing a connect test could add.
    expect(
      calls.some((cmd) => cmd.includes('shell') && cmd.some((arg) => arg.includes('nc -w 3 127.0.0.1 8899'))),
    ).toBe(false)
  })

  test('fails a device port that has no reverse at all', async () => {
    const { runCommand } = checkRunner(correctReverses.slice(1))

    const report = await createLocalnetCheckReport(
      localnet,
      {},
      { fetchJsonRpc: async () => ({ result: 'ok' }), runCommand },
    )

    expect(report.ok).toBe(false)
    expect(report.devices[0]?.ports[0]).toMatchObject({ name: 'rpc', ok: false, reason: 'no reverse on device' })
  })

  test('checks the reverse against the host port the session actually uses', async () => {
    // With `--port 9899` the expected mapping is 8899 -> 9899, so the default-looking reverse is wrong.
    const { runCommand } = checkRunner(correctReverses)

    const report = await createLocalnetCheckReport(
      resolveLocalnet('surfpool', { ports: { port: 9899 } }),
      {},
      { fetchJsonRpc: async () => ({ result: 'ok' }), runCommand },
    )

    expect(report.devices[0]?.ports[0]).toMatchObject({
      hostPort: 9899,
      ok: false,
      reason: 'reverse points at host port 8899, expected 9899',
    })
  })

  test('skips probing devices that are not usable', async () => {
    const report = await createLocalnetCheckReport(
      localnet,
      {},
      {
        fetchJsonRpc: async () => ({ result: 'ok' }),
        runCommand: async () => 'List of devices attached\nZY22G9WXYZ\tunauthorized\n',
      },
    )

    expect(report.devices[0]?.ports).toEqual([])
    expect(report.ok).toBe(false)
  })
})

describe('localnet endpoints', () => {
  test('lists the rpc, ws, and studio urls for surfpool', () => {
    expect(endpointsMessage(localnetEndpoints(resolveLocalnet('surfpool')))).toBe(
      ['RPC     http://localhost:8899', 'WS      ws://localhost:8900', 'Studio  http://localhost:18488'].join('\n'),
    )
  })

  test('omits studio for an engine that does not serve it', () => {
    const message = endpointsMessage(localnetEndpoints(resolveLocalnet('test-validator')))

    expect(message).not.toContain('Studio')
    expect(message).toContain('RPC  http://localhost:8899')
  })

  test('keeps app-facing urls on the device port and studio on the host port', () => {
    // `--port` moves the host side only: the app still uses 8899, while Studio is opened locally.
    const endpoints = localnetEndpoints(resolveLocalnet('surfpool', { ports: { port: 9899, studioPort: 19488 } }))

    expect(endpoints.find(({ name }) => name === 'rpc')?.url).toBe('http://localhost:8899')
    expect(endpoints.find(({ name }) => name === 'studio')?.url).toBe('http://localhost:19488')
  })

  test('notes the host url only for app-facing endpoints that moved', () => {
    const message = endpointsMessage(localnetEndpoints(resolveLocalnet('surfpool', { ports: { port: 9899 } })))

    expect(message).toContain('RPC     http://localhost:8899')
    expect(message).toContain('From this computer: RPC http://localhost:9899')
    expect(message).not.toContain('Studio http://localhost:18488,')
  })

  test('says nothing extra when no host port moved', () => {
    expect(endpointsMessage(localnetEndpoints(resolveLocalnet('surfpool')))).not.toContain('From this computer')
  })
})

describe('localnet container session', () => {
  const inspectOutput = (
    status: string,
    { bindings = '{"8899/tcp":[{"HostIp":"","HostPort":"9899"}]}', label = 'surfpool' } = {},
  ) => [status, 'none', label, bindings].join('|')

  test('reads the host ports the container was published on', () => {
    // Regression guard: only the engine used to be recorded, so `--port 9899` was forgotten the moment
    // the starting process exited and every later command fell back to 8899.
    expect(parseContainerStatus(inspectOutput('running')).publishedPorts).toEqual({ 8899: 9899 })
  })

  test('ignores port bindings docker did not publish', () => {
    expect(parsePublishedPorts('{"8900/tcp":null}')).toBeUndefined()
    expect(parsePublishedPorts('{}')).toBeUndefined()
    expect(parsePublishedPorts('not json')).toBeUndefined()
    expect(parsePublishedPorts(undefined)).toBeUndefined()
  })

  test('treats only a recognized engine label as ours', () => {
    expect(isManagedContainer(parseContainerStatus(inspectOutput('running')))).toBe(true)
    expect(isManagedContainer(parseContainerStatus(inspectOutput('running', { label: '<no value>' })))).toBe(false)
    // A label we do not recognize is not a container we made, whatever it says.
    expect(parseContainerStatus(inspectOutput('running', { label: 'geyser' })).engine).toBeUndefined()
  })

  test('inherits the engine and host ports of the running container', () => {
    const container = parseContainerStatus(inspectOutput('running', { label: 'test-validator' }))
    const localnet = resolveLocalnetForContainer(container)

    expect(localnet.engine.id).toBe('test-validator')
    expect(localnetRpcUrl(localnet)).toBe('http://localhost:9899')
    // test-validator serves no Studio, so nothing should try to forward one.
    expect(localnet.ports.map(({ name }) => name)).toEqual(['rpc', 'ws'])
  })

  test('lets explicit options win over the container', () => {
    const container = parseContainerStatus(inspectOutput('running'))

    expect(localnetRpcUrl(resolveLocalnetForContainer(container, { port: 7777 }))).toBe('http://localhost:7777')
  })

  test('rejects an engine that conflicts with the running container', () => {
    const container = parseContainerStatus(inspectOutput('running', { label: 'test-validator' }))

    expect(() => resolveLocalnetForContainer(container, { engine: 'surfpool' })).toThrow(
      'A test-validator container is already running',
    )
    // A stopped container is about to be replaced, so it is not a conflict.
    expect(() =>
      resolveLocalnetForContainer(parseContainerStatus(inspectOutput('exited', { label: 'test-validator' })), {
        engine: 'surfpool',
      }),
    ).not.toThrow()
  })

  test('does not inherit configuration from a stopped container when starting', () => {
    // `start` replaces a stopped container, so it must define its own engine and ports.
    const stopped = parseContainerStatus(inspectOutput('exited', { label: 'test-validator' }))

    expect(resolveLocalnetForContainer(stopped, {}, { runningOnly: true }).engine.id).toBe('surfpool')
    // Every other command acts on the session that exists, stopped or not.
    expect(resolveLocalnetForContainer(stopped).engine.id).toBe('test-validator')
  })

  test('reports the detached session ports rather than the defaults', async () => {
    const { runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') return inspectOutput('running', { label: 'test-validator' })
      if (cmd[1] === 'devices') return 'List of devices attached\n'
      return ''
    })

    const report = await createLocalnetStatusReport({}, { runCommand })

    expect(report).toMatchObject({ engine: 'test-validator', rpcUrl: 'http://localhost:9899' })
  })

  test('reuses the recorded engine instead of defaulting to surfpool', async () => {
    // Regression guard: the engine was resolved before the container was inspected, so a detached
    // test-validator container was reused as though it were surfpool — advertising Studio and creating a
    // reverse for a port nothing serves.
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') return inspectOutput('running', { label: 'test-validator' })
      if (cmd[1] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n'
      if (cmd.includes('--list')) return ''
      return ''
    })
    const { dependencies, state } = startDependencies(runCommand, async () => ({ result: 'ok' }))

    await runLocalnetStart({ detach: true }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(calls.some((cmd) => cmd.includes('tcp:18488'))).toBe(false)
    // The container publishes 9899, so the reverse has to point there and not at the canonical port.
    expect(calls).toContainEqual(['adb', '-s', 'emulator-5554', 'reverse', 'tcp:8899', 'tcp:9899'])
  })

  test('refuses to start over a container it did not create', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') return inspectOutput('exited', { label: '<no value>' })
      if (cmd[1] === 'devices') return 'List of devices attached\n'
      return ''
    })
    const { dependencies, state } = startDependencies(runCommand, async () => {
      throw new Error('Unable to connect')
    })
    // This is the one test that exercises a failing command, and failing sets the exit code of the
    // process running the suite.
    const exitCode = process.exitCode ?? 0

    await runLocalnetStart({ detach: true }, dependencies)
    process.exitCode = exitCode

    expect(state.cancelled).toContain('was not created by solana-mobile localnet')
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'rm')).toBe(false)
    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')).toBe(false)
  })

  test('leaves a container it did not create alone on stop', async () => {
    // Regression guard: anything holding the name used to be force-removed, label or no label.
    const messages: string[] = []
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') return inspectOutput('running', { label: '<no value>' })
      if (cmd[1] === 'devices') return 'List of devices attached\n'
      return ''
    })

    await runLocalnetStop(
      {},
      {
        cancel: () => {},
        intro: () => {},
        log: (message) => messages.push(message),
        outro: () => {},
        runCommand,
      },
    )

    expect(calls.some((cmd) => cmd[0] === 'docker' && cmd[1] === 'rm')).toBe(false)
    expect(messages.join('\n')).toContain('docker rm --force solana-mobile-localnet')
  })

  test('removes its own container on stop', async () => {
    const { calls, runCommand } = recordingRunner((cmd) => {
      if (cmd[1] === 'inspect') return inspectOutput('running')
      if (cmd[1] === 'devices') return 'List of devices attached\n'
      return ''
    })

    await runLocalnetStop({}, { cancel: () => {}, intro: () => {}, log: () => {}, outro: () => {}, runCommand })

    expect(calls).toContainEqual(['docker', 'rm', '--force', 'solana-mobile-localnet'])
  })
})

describe('localnet forward ownership', () => {
  const existing = existingMap({
    'emulator-5554': [
      { devicePort: 8081, hostPort: 8081 },
      { devicePort: 8899, hostPort: 8899 },
      { devicePort: 18488, hostPort: 18488 },
    ],
  })

  test('claims only the forwards a plan had to create or replace', () => {
    const actions = planForwards({
      devices: [{ serial: 'emulator-5554', state: 'device' }],
      existing,
      ports: SURFPOOL_PORTS,
    })

    // 8899 and 18488 were already correct; only the missing ws port is this session's to own.
    expect(ownedForwards(actions)).toEqual([{ devicePort: 8900, serial: 'emulator-5554' }])
  })

  test('restricts removals to the forwards a session owns', () => {
    expect(
      planRemovals({ existing, owned: [{ devicePort: 8899, serial: 'emulator-5554' }], ports: SURFPOOL_PORTS }),
    ).toEqual([{ devicePort: 8899, serial: 'emulator-5554' }])
    // A session that owns nothing removes nothing, even on canonical ports.
    expect(planRemovals({ existing, owned: [], ports: SURFPOOL_PORTS })).toEqual([])
  })

  test('matches a reverse against its expected mapping', () => {
    const rpc = SURFPOOL_PORTS[0] as ResolvedLocalnetPort

    expect(matchReverse([{ devicePort: 8899, hostPort: 8899 }], rpc)).toEqual({ kind: 'match' })
    expect(matchReverse([{ devicePort: 8899, hostPort: 9000 }], rpc)).toEqual({ hostPort: 9000, kind: 'mismatch' })
    expect(matchReverse([{ devicePort: 8900, hostPort: 8900 }], rpc)).toEqual({ kind: 'missing' })
    expect(matchReverse(undefined, rpc)).toEqual({ kind: 'missing' })
  })
})

describe('localnet command', () => {
  // The command tree stands on its own, so its shape is asserted straight off the factory. Everything
  // below parses through the real root instead: the flags-on-either-side behaviour depends on the
  // settings `createApp` applies to the tree, so a hand-rolled root would only test the hand-rolled root.
  test('registers localnet subcommands', () => {
    expect(createLocalnetCommand().commands.map((command) => command.name())).toEqual([
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
})
