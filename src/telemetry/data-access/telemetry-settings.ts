import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const telemetrySettingsSchema = z.object({
  enabled: z.boolean(),
  installId: z.string().min(1),
  promptedAt: z.string(),
})

export type TelemetrySettings = z.infer<typeof telemetrySettingsSchema>

export function defaultTelemetrySettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'solana-mobile', 'telemetry.json')
}

/**
 * Resolves the environment's say on telemetry: false when `DO_NOT_TRACK` or
 * `SOLANA_MOBILE_TELEMETRY=0` turn it off, true when `SOLANA_MOBILE_TELEMETRY=1` turns it on, and
 * undefined when the saved setting decides. Turning it off always wins.
 */
export function getTelemetryEnvOverride(env: NodeJS.ProcessEnv): boolean | undefined {
  const value = env.SOLANA_MOBILE_TELEMETRY

  if (isTruthy(env.DO_NOT_TRACK) || value === '0' || value === 'false') {
    return false
  }

  return value === '1' || value === 'true' ? true : undefined
}

// A missing or unreadable file reads as "never asked", so a corrupted file re-prompts instead of crashing
export async function readTelemetrySettings(path: string): Promise<TelemetrySettings | undefined> {
  try {
    return telemetrySettingsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return undefined
  }
}

export async function writeTelemetrySettings(path: string, settings: TelemetrySettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`)
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value !== 'false'
}
