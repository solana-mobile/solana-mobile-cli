import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  inspectLocalnetContainer,
  readLocalnetContainerLogs,
  removeLocalnetContainer,
  startLocalnetContainer,
} from '../../src/localnet/data-access/docker-engine.ts'
import { localnetRpcUrl, resolveLocalnet } from '../../src/localnet/data-access/localnet-engines.ts'
import type { LocalnetEngineId } from '../../src/localnet/data-access/localnet-types.ts'
import { defaultJsonRpcFetcher, waitForRpc } from '../../src/localnet/data-access/probe-rpc.ts'

/**
 * Boots each engine for real. The unit tests assert the exact `docker run` argv, which only proves we
 * build the command we meant to; these prove the command works — that the image is still published, its
 * CLI still accepts our flags, and it serves RPC on the published ports. That contract is with Docker Hub
 * and the images themselves, so it can break with no change on our side. Hence the nightly schedule.
 *
 * Requires Docker. Excluded from `bun run test` (which globs `test/*.test.ts` only) so the unit suite
 * stays dependency-free; run with `bun run test:integration`.
 */

// A dedicated name and high host ports, so running this never disturbs a real `solana-mobile localnet`.
const containerName = 'solana-mobile-localnet-test'
const ports = { port: 28899, studioPort: 28488, wsPort: 28900 }

const ENGINES: LocalnetEngineId[] = ['surfpool', 'test-validator']

describe.each(ENGINES)('localnet engine %s', (engineId) => {
  beforeEach(async () => {
    // A container left by an interrupted run would fail the next `docker run` on the name conflict.
    await removeLocalnetContainer({ containerName }).catch(() => {})
  })

  afterEach(async () => {
    await removeLocalnetContainer({ containerName }).catch(() => {})
  })

  test('starts from our own docker command and answers JSON-RPC', async () => {
    const localnet = resolveLocalnet(engineId, { ports })

    await startLocalnetContainer(localnet, { containerName })

    const rpc = await waitForRpc(localnetRpcUrl(localnet), {
      // Surface the container's own logs instead of timing out silently when the image is broken.
      onAttempt: async () => {
        const status = await inspectLocalnetContainer({ containerName })

        if (status.status && !status.running) {
          const logs = await readLocalnetContainerLogs({ lines: 50 }, { containerName }).catch(() => '')

          throw new Error(`${engineId} container exited (${status.status})\n${logs}`)
        }
      },
      timeoutMs: 180_000,
    })

    expect(rpc.error).toBeUndefined()
    expect(rpc.ok).toBe(true)
    // A version proves a real getVersion round trip, not just an open socket.
    expect(rpc.version).toBeTruthy()

    // The engine label exists to be read back by `status` and `stop`. Only a real round trip through
    // Docker shows that it is written and queried under the same key.
    const status = await inspectLocalnetContainer({ containerName })

    expect(status.running).toBe(true)
    expect(status.engine).toBe(engineId)
  }, 300_000)
})

describe('localnet surfpool datasource', () => {
  beforeEach(async () => {
    await removeLocalnetContainer({ containerName }).catch(() => {})
  })

  afterEach(async () => {
    await removeLocalnetContainer({ containerName }).catch(() => {})
  })

  test('forks from devnet and reports its genesis hash', async () => {
    // The unit tests prove we pass `--network devnet`; this proves surfpool still accepts it and actually
    // forks — the genesis hash is devnet's, not a fresh chain's. Needs the public devnet RPC reachable.
    const localnet = resolveLocalnet('surfpool', { datasource: { network: 'devnet' }, ports })

    await startLocalnetContainer(localnet, { containerName })

    const rpcUrl = localnetRpcUrl(localnet)
    const rpc = await waitForRpc(rpcUrl, {
      onAttempt: async () => {
        const status = await inspectLocalnetContainer({ containerName })

        if (status.status && !status.running) {
          const logs = await readLocalnetContainerLogs({ lines: 50 }, { containerName }).catch(() => '')

          throw new Error(`surfpool container exited (${status.status})\n${logs}`)
        }
      },
      timeoutMs: 180_000,
    })

    expect(rpc.ok).toBe(true)

    const genesis = (await defaultJsonRpcFetcher(rpcUrl, 'getGenesisHash')) as { result?: string }

    expect(genesis.result).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')

    // The datasource label is what a later `start` compares against; prove a real round trip through Docker.
    const status = await inspectLocalnetContainer({ containerName })

    expect(status.datasource).toBe('network=devnet')
  }, 300_000)
})
