import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import type { CommandRunner } from '../src/core/data-access/command-types.ts'
import {
  DEFAULT_PLAYGROUND_CLUSTER,
  PLAYGROUND_DEVICE_PORT,
  parsePlaygroundClusterId,
  playgroundConfig,
  resolvePlaygroundCluster,
} from '../src/playground/data-access/playground-clusters.ts'
import { type PlaygroundServer, startPlaygroundServer } from '../src/playground/data-access/playground-server.ts'
import type { PlaygroundConfig, PlaygroundEvent } from '../src/playground/data-access/playground-types.ts'
import { runPlayground } from '../src/playground/playground-feature-serve.ts'
import { renderPlaygroundEvent } from '../src/playground/ui/playground-ui-messages.ts'

const TEST_CONFIG: PlaygroundConfig = {
  chain: 'solana:devnet',
  cluster: 'devnet',
  rpcUrl: 'https://api.devnet.solana.com',
}

function testServer(overrides: Partial<Parameters<typeof startPlaygroundServer>[0]> = {}) {
  const events: PlaygroundEvent[] = []
  const pageLoads: number[] = []

  const server = startPlaygroundServer({
    config: TEST_CONFIG,
    onEvent: (event) => events.push(event),
    onPageLoad: () => pageLoads.push(1),
    page: '<html>playground</html>',
    port: 0,
    strictPort: true,
    ...overrides,
  })

  return { events, pageLoads, server }
}

async function postEvent(server: PlaygroundServer, body: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${server.port}/events`, {
    body,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  return response.status
}

describe('playground-clusters', () => {
  test('parses every known cluster id', () => {
    for (const id of ['devnet', 'localnet', 'mainnet', 'testnet'] as const) {
      expect(parsePlaygroundClusterId(id)).toBe(id)
    }
  })

  test('rejects unknown cluster ids with the accepted list', () => {
    expect(() => parsePlaygroundClusterId('mainnet-beta')).toThrow(
      'Unknown cluster: mainnet-beta. Expected one of: devnet, localnet, mainnet, testnet',
    )
  })

  test('rejects inherited Object.prototype members as cluster ids', () => {
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty']) {
      expect(() => parsePlaygroundClusterId(inherited)).toThrow(`Unknown cluster: ${inherited}`)
    }
  })

  test('defaults to devnet', () => {
    expect(DEFAULT_PLAYGROUND_CLUSTER).toBe('devnet')
    expect(resolvePlaygroundCluster().id).toBe('devnet')
  })

  test('mainnet has no default endpoint until a --url is supplied', () => {
    const withoutUrl = resolvePlaygroundCluster({ cluster: 'mainnet' })

    expect(withoutUrl.chain).toBe('solana:mainnet')
    expect(withoutUrl.rpcUrl).toBe('')

    const withUrl = resolvePlaygroundCluster({ cluster: 'mainnet', url: 'https://rpc.example.com' })

    expect(withUrl.rpcUrl).toBe('https://rpc.example.com')
  })

  test('localnet authorizes as devnet against the device-side RPC', () => {
    const cluster = resolvePlaygroundCluster({ cluster: 'localnet' })

    expect(cluster.chain).toBe('solana:devnet')
    expect(cluster.rpcUrl).toBe('http://localhost:8899')
  })

  test('--url overrides the RPC endpoint but keeps the chain id', () => {
    const cluster = resolvePlaygroundCluster({ cluster: 'testnet', url: 'https://rpc.example.com' })

    expect(cluster.chain).toBe('solana:testnet')
    expect(cluster.rpcUrl).toBe('https://rpc.example.com')
  })

  test('playgroundConfig carries chain, cluster, and RPC URL', () => {
    expect(playgroundConfig(resolvePlaygroundCluster())).toEqual(TEST_CONFIG)
  })
})

describe('playground-server', () => {
  test('serves the page, the config, and accepts events', async () => {
    const { events, pageLoads, server: pending } = testServer()
    const server = await pending

    try {
      const page = await fetch(`http://127.0.0.1:${server.port}/`)

      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect(await page.text()).toContain('playground')

      const config = await fetch(`http://127.0.0.1:${server.port}/config.json`)

      expect(await config.json()).toEqual(TEST_CONFIG)
      expect(pageLoads.length).toBe(1)

      const event: PlaygroundEvent = { detail: 'abc', kind: 'connect', ok: true }

      expect(await postEvent(server, JSON.stringify(event))).toBe(204)
      expect(events).toEqual([event])
    } finally {
      await server.close()
    }
  })

  test('rejects malformed events and unknown routes', async () => {
    const { events, server: pending } = testServer()
    const server = await pending

    try {
      expect(await postEvent(server, 'not json')).toBe(400)
      expect(await postEvent(server, JSON.stringify({ kind: 'nope', ok: true }))).toBe(400)
      expect(events).toEqual([])

      const missing = await fetch(`http://127.0.0.1:${server.port}/nope`)

      expect(missing.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  test('shifts to a free port unless the port was forced', async () => {
    const first = await testServer().server

    try {
      const shifted = await testServer({ port: first.port, strictPort: false }).server

      expect(shifted.port).not.toBe(first.port)
      expect(shifted.port).toBeGreaterThan(first.port)
      await shifted.close()

      await expect(testServer({ port: first.port, strictPort: true }).server).rejects.toThrow(
        `Port ${first.port} is already in use`,
      )
    } finally {
      await first.close()
    }
  })
})

describe('playground page asset', () => {
  // The page is inlined into the compiled bundle rather than shipped as a separate file. Guard both
  // halves of that: the built CLI contains the page, and no stray playground-page asset is emitted. `bun
  // run ci` builds before testing, so dist exists here; skip when running tests in isolation.
  test('is inlined into the built CLI, not shipped as a separate asset', () => {
    const bundle = new URL('../dist/cli.mjs', import.meta.url)

    if (!existsSync(bundle)) {
      return
    }

    expect(readFileSync(bundle, 'utf8')).toContain('Solana Mobile Playground')
    expect(existsSync(new URL('../dist/playground-page.html', import.meta.url))).toBe(false)
  })
})

describe('playground-ui-messages', () => {
  test('renders successes with their detail', () => {
    expect(renderPlaygroundEvent({ detail: '8xF3…9k2A', kind: 'connect', ok: true })).toBe('✔ Connect — 8xF3…9k2A')
  })

  test('renders failures without detail', () => {
    expect(renderPlaygroundEvent({ kind: 'sign-message', ok: false })).toBe('✖ Sign Message')
  })
})

describe('runPlayground', () => {
  function recordingRunner(): { calls: string[][]; runCommand: CommandRunner } {
    const calls: string[][] = []
    const runCommand: CommandRunner = async (cmd) => {
      calls.push([...cmd])

      if (cmd[1] === 'devices') {
        return 'List of devices attached\nemulator-5554\tdevice\n'
      }

      if (cmd.includes('avd')) {
        return 'Pixel_9\nOK\n'
      }

      return ''
    }

    return { calls, runCommand }
  }

  function playgroundDependencies(runCommand: CommandRunner, waitForStop: () => Promise<void>) {
    const state: { cancelled?: string; logs: string[]; outro?: string } = { logs: [] }

    return {
      dependencies: {
        cancel: (message: string) => {
          state.cancelled = message
        },
        intro: () => {},
        loadPage: () => '<html>test-page</html>',
        log: (message: string) => {
          state.logs.push(message)
        },
        note: () => {},
        outro: (message: string) => {
          state.outro = message
        },
        runCommand,
        waitForStop,
      },
      state,
    }
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) {
        return
      }

      await Bun.sleep(10)
    }

    throw new Error('Timed out waiting for a condition')
  }

  test('serves, forwards, opens, streams events, and tears down', async () => {
    const { calls, runCommand } = recordingRunner()
    let stop: () => void = () => {}
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    const { dependencies, state } = playgroundDependencies(runCommand, () => stopped)

    const run = runPlayground({}, dependencies)

    await waitFor(() => state.logs.some((line) => line.startsWith('Forwarded device port')))

    const hostPort = Number(/host port (\d+)$/.exec(state.logs.find((line) => line.startsWith('Forwarded')) ?? '')?.[1])

    expect(hostPort).toBeGreaterThan(0)
    expect(calls).toContainEqual([
      'adb',
      '-s',
      'emulator-5554',
      'reverse',
      `tcp:${PLAYGROUND_DEVICE_PORT}`,
      `tcp:${hostPort}`,
    ])

    const page = await fetch(`http://127.0.0.1:${hostPort}/`)

    expect(await page.text()).toBe('<html>test-page</html>')

    const posted = await fetch(`http://127.0.0.1:${hostPort}/events`, {
      body: JSON.stringify({ detail: 'abc', kind: 'connect', ok: true }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(posted.status).toBe(204)
    await waitFor(() => state.logs.includes('✔ Connect — abc'))

    stop()
    await run

    expect(calls).toContainEqual([
      'adb',
      '-s',
      'emulator-5554',
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `http://localhost:${PLAYGROUND_DEVICE_PORT}`,
    ])
    expect(calls).toContainEqual(['adb', '-s', 'emulator-5554', 'reverse', '--remove', `tcp:${PLAYGROUND_DEVICE_PORT}`])
    expect(state.cancelled).toBeUndefined()
    expect(state.outro).toBe('Done')
  })

  test('--no-open skips launching the device browser', async () => {
    const { calls, runCommand } = recordingRunner()
    const { dependencies, state } = playgroundDependencies(runCommand, () => Promise.resolve())

    await runPlayground({ open: false }, dependencies)

    expect(calls.some((cmd) => cmd.includes('am'))).toBe(false)
    expect(
      state.logs.some((line) => line.startsWith(`Open http://localhost:${PLAYGROUND_DEVICE_PORT} on the device`)),
    ).toBe(true)
    expect(state.outro).toBe('Done')
  })

  test('reports when no devices are connected', async () => {
    const exitCodeBefore = process.exitCode
    const runCommand: CommandRunner = async (cmd) => (cmd[1] === 'devices' ? 'List of devices attached\n' : '')
    const { dependencies, state } = playgroundDependencies(runCommand, () => Promise.resolve())

    await runPlayground({}, dependencies)

    expect(state.outro).toBe('Done')
    expect(process.exitCode).toBe(1)
    process.exitCode = exitCodeBefore ?? 0
  })

  test('refuses mainnet without a --url and never touches a device', async () => {
    const exitCodeBefore = process.exitCode
    const calls: string[][] = []
    const runCommand: CommandRunner = async (cmd) => {
      calls.push([...cmd])
      return ''
    }
    const { dependencies, state } = playgroundDependencies(runCommand, () => Promise.resolve())

    await runPlayground({ cluster: 'mainnet' }, dependencies)

    expect(calls).toEqual([])
    expect(state.outro).toBe('Done')
    expect(process.exitCode).toBe(1)
    process.exitCode = exitCodeBefore ?? 0
  })

  test('runs mainnet when a --url is supplied', async () => {
    const { calls, runCommand } = recordingRunner()
    let stop: () => void = () => {}
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    const { dependencies, state } = playgroundDependencies(runCommand, () => stopped)

    const run = runPlayground({ cluster: 'mainnet', url: 'https://rpc.example.com' }, dependencies)

    await waitFor(() => state.logs.some((line) => line.startsWith('Forwarded device port')))
    stop()
    await run

    expect(calls.some((cmd) => cmd.includes('am'))).toBe(true)
    expect(state.outro).toBe('Done')
  })

  test('closes the server when opening the page fails', async () => {
    const exitCodeBefore = process.exitCode
    const runCommand: CommandRunner = async (cmd) => {
      if (cmd[1] === 'devices') {
        return 'List of devices attached\nemulator-5554\tdevice\n'
      }

      if (cmd.includes('avd')) {
        return 'Pixel_9\nOK\n'
      }

      // Fail on the `am start` that opens the page, after the server is listening and forwarded.
      if (cmd.includes('am')) {
        throw new Error('boom')
      }

      return ''
    }
    const { dependencies, state } = playgroundDependencies(runCommand, () => Promise.resolve())

    await runPlayground({}, dependencies)

    const hostPort = Number(/host port (\d+)/.exec(state.logs.find((line) => line.startsWith('Forwarded')) ?? '')?.[1])

    expect(hostPort).toBeGreaterThan(0)
    expect(state.cancelled).toContain('boom')
    // The finally must have torn the server down: the forwarded host port no longer accepts connections.
    await expect(fetch(`http://127.0.0.1:${hostPort}/`)).rejects.toThrow()
    process.exitCode = exitCodeBefore ?? 0
  })
})
