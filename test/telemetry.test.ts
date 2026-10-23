import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.ts'
import type { TelemetryClientOptions } from '../src/telemetry/data-access/telemetry-client.ts'
import {
  defaultTelemetrySettingsPath,
  getTelemetryEnvOverride,
  readTelemetrySettings,
  writeTelemetrySettings,
} from '../src/telemetry/data-access/telemetry-settings.ts'
import { runTelemetry, type StartTelemetryOptions, startTelemetry } from '../src/telemetry/telemetry-feature-index.ts'

const metadata = { description: 'test', name: 'solana-mobile', version: '1.2.3' }

function settingsPath() {
  return join(mkdtempSync(join(tmpdir(), 'solana-mobile-telemetry-')), 'telemetry.json')
}

function start(overrides: Partial<StartTelemetryOptions> = {}) {
  const started: TelemetryClientOptions[] = []
  let prompted = 0
  const result = startTelemetry({
    dsn: 'https://key@example.com/1',
    env: {},
    initClient: (options) => {
      started.push(options)
    },
    isInteractive: true,
    metadata,
    promptConsent: async () => {
      prompted++
      return true
    },
    settingsPath: settingsPath(),
    ...overrides,
  })

  return { prompted: () => prompted, result, started }
}

describe('telemetry settings', () => {
  test('stores settings under XDG_CONFIG_HOME', () => {
    expect(defaultTelemetrySettingsPath({ XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/solana-mobile/telemetry.json')
  })

  test('falls back to ~/.config', () => {
    expect(defaultTelemetrySettingsPath({})).toEndWith(join('.config', 'solana-mobile', 'telemetry.json'))
  })

  test('lets the environment turn telemetry off or on, with off winning', () => {
    expect(getTelemetryEnvOverride({})).toBeUndefined()
    expect(getTelemetryEnvOverride({ DO_NOT_TRACK: '1' })).toBe(false)
    expect(getTelemetryEnvOverride({ SOLANA_MOBILE_TELEMETRY: '0' })).toBe(false)
    expect(getTelemetryEnvOverride({ SOLANA_MOBILE_TELEMETRY: '1' })).toBe(true)
    expect(getTelemetryEnvOverride({ DO_NOT_TRACK: '1', SOLANA_MOBILE_TELEMETRY: '1' })).toBe(false)
  })

  test('reads a corrupted settings file as never asked', async () => {
    const path = settingsPath()
    await Bun.write(path, '{not json')

    expect(await readTelemetrySettings(path)).toBeUndefined()
  })
})

describe('startTelemetry', () => {
  test('asks once on the first interactive run and saves the answer', async () => {
    const path = settingsPath()
    const first = start({ settingsPath: path })

    expect(await first.result).toBe(true)
    expect(first.prompted()).toBe(1)

    const second = start({ settingsPath: path })

    expect(await second.result).toBe(true)
    expect(second.prompted()).toBe(0)
    expect(second.started[0]?.installId).toBe((await readTelemetrySettings(path))?.installId as string)
  })

  test('saves a no and never starts the client', async () => {
    const path = settingsPath()
    const run = start({ promptConsent: async () => false, settingsPath: path })

    expect(await run.result).toBe(false)
    expect(run.started).toHaveLength(0)
    expect((await readTelemetrySettings(path))?.enabled).toBe(false)
  })

  test('never prompts without a terminal or in CI', async () => {
    for (const overrides of [{ isInteractive: false }, { env: { CI: 'true' } }]) {
      const run = start(overrides)

      expect(await run.result).toBe(false)
      expect(run.prompted()).toBe(0)
    }
  })

  test('honors DO_NOT_TRACK over a saved yes', async () => {
    const path = settingsPath()
    await writeTelemetrySettings(path, { enabled: true, installId: 'abc', promptedAt: 'now' })
    const run = start({ env: { DO_NOT_TRACK: '1' }, settingsPath: path })

    expect(await run.result).toBe(false)
    expect(run.started).toHaveLength(0)
  })

  test('starts without prompting when SOLANA_MOBILE_TELEMETRY=1', async () => {
    const run = start({ env: { SOLANA_MOBILE_TELEMETRY: '1' }, isInteractive: false })

    expect(await run.result).toBe(true)
    expect(run.prompted()).toBe(0)
  })

  test('never sends without a DSN', async () => {
    const run = start({ dsn: '' })

    expect(await run.result).toBe(false)
    expect(run.started).toHaveLength(0)
  })

  test('never throws when the settings cannot be written', async () => {
    const run = start({ settingsPath: '/dev/null/telemetry.json' })

    expect(await run.result).toBe(false)
  })
})

describe('telemetry command', () => {
  test('enables and disables while keeping the install id', async () => {
    const path = settingsPath()
    const log = console.log
    console.log = () => {}

    try {
      await runTelemetry('enable', { env: {}, settingsPath: path })
      const enabled = await readTelemetrySettings(path)
      await runTelemetry('disable', { env: {}, settingsPath: path })
      const disabled = await readTelemetrySettings(path)

      expect(enabled?.enabled).toBe(true)
      expect(disabled?.enabled).toBe(false)
      expect(disabled?.installId).toBe(enabled?.installId as string)
    } finally {
      console.log = log
    }
  })

  test('does not start telemetry for the telemetry command itself', async () => {
    let startCalled = false
    const app = createApp({
      checkForNewerVersion: async () => undefined,
      runTelemetry: async () => {},
      startTelemetry: async () => {
        startCalled = true
        return false
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'telemetry', 'status'])

    expect(startCalled).toBe(false)
  })

  test('starts telemetry before other commands', async () => {
    let startCalled = false
    const app = createApp({
      checkForNewerVersion: async () => undefined,
      runEmulatorList: async () => {},
      startTelemetry: async () => {
        startCalled = true
        return false
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'emulator', 'list'])

    expect(startCalled).toBe(true)
  })
})
