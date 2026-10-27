import { randomUUID } from 'node:crypto'
import type { PackageMetadata } from '../core/data-access/package-metadata.ts'
import { initTelemetryClient, TELEMETRY_DSN, type TelemetryClientOptions } from './data-access/telemetry-client.ts'
import {
  defaultTelemetrySettingsPath,
  getTelemetryEnvOverride,
  readTelemetrySettings,
  type TelemetrySettings,
  writeTelemetrySettings,
} from './data-access/telemetry-settings.ts'
import { promptTelemetryConsent } from './ui/telemetry-ui-consent.ts'

export type TelemetryAction = 'disable' | 'enable' | 'status'

export type StartTelemetryOptions = {
  dsn?: string
  env?: NodeJS.ProcessEnv
  initClient?: (options: TelemetryClientOptions) => void
  isInteractive?: boolean
  metadata: PackageMetadata
  promptConsent?: () => Promise<boolean>
  settingsPath?: string
}

export type TelemetryCommandOptions = {
  env?: NodeJS.ProcessEnv
  settingsPath?: string
}

/**
 * Asks for consent once on the first interactive run, then starts the client only when telemetry
 * is on. Resolves whether it started. Never throws: a broken config directory means no telemetry,
 * not a broken CLI. Never prompts in CI, without a terminal, or under tests.
 */
export async function startTelemetry({
  dsn = TELEMETRY_DSN,
  env = process.env,
  initClient = initTelemetryClient,
  isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true,
  metadata,
  promptConsent = promptTelemetryConsent,
  settingsPath = defaultTelemetrySettingsPath(env),
}: StartTelemetryOptions): Promise<boolean> {
  try {
    const override = getTelemetryEnvOverride(env)

    if (override === false || env.NODE_ENV === 'test') {
      return false
    }

    let settings = await readTelemetrySettings(settingsPath)

    if (!settings && override === undefined && isInteractive && !env.CI) {
      settings = { enabled: await promptConsent(), installId: randomUUID(), promptedAt: new Date().toISOString() }
      await writeTelemetrySettings(settingsPath, settings)
    }

    if (!(override ?? settings?.enabled) || !dsn) {
      return false
    }

    initClient({ dsn, installId: settings?.installId ?? randomUUID(), metadata })

    return true
  } catch {
    return false
  }
}

export async function runTelemetry(
  action: TelemetryAction,
  { env = process.env, settingsPath = defaultTelemetrySettingsPath(env) }: TelemetryCommandOptions = {},
): Promise<void> {
  const settings = await readTelemetrySettings(settingsPath)

  if (action !== 'status') {
    const next: TelemetrySettings = {
      enabled: action === 'enable',
      installId: settings?.installId ?? randomUUID(),
      promptedAt: settings?.promptedAt ?? new Date().toISOString(),
    }

    await writeTelemetrySettings(settingsPath, next)
    console.log(`Telemetry ${next.enabled ? 'enabled' : 'disabled'}.`)
    return
  }

  const override = getTelemetryEnvOverride(env)

  console.log(`Telemetry: ${(override ?? settings?.enabled) ? 'enabled' : 'disabled'}`)
  console.log(`Settings: ${settingsPath}`)

  if (override !== undefined) {
    console.log('Set by environment: DO_NOT_TRACK or SOLANA_MOBILE_TELEMETRY')
  }
}
