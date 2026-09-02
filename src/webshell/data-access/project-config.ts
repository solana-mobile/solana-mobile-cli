import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const WEBSHELL_PROJECT_CONFIG_FILENAME = 'twa-manifest.json'

/** What init persists into a generated project. */
export interface WebshellProjectConfig {
  appName: string
  applicationId: string
  keystoreAlias?: string
  keystorePath?: string
  url: string
  webManifestUrl?: string
}

/** The subset the build flow reads back; `undefined` means the directory is not a webshell project. */
export interface SavedWebshellProjectConfig {
  keystoreAlias?: string
  keystorePath?: string
}

/**
 * Writes the Bubblewrap-compatible `twa-manifest.json`, carrying over fields this CLI does not own so
 * a project that started life under Bubblewrap keeps working there.
 */
export async function writeWebshellProjectConfig(
  projectDirectory: string,
  config: WebshellProjectConfig,
): Promise<void> {
  const configPath = join(projectDirectory, WEBSHELL_PROJECT_CONFIG_FILENAME)
  const url = new URL(config.url)

  const merged: Record<string, unknown> = {
    ...(await readTwaManifest(configPath)),
    fallbackType: 'webview',
    generatorApp: 'solana-mobile',
    host: url.host,
    launcherName: config.appName,
    name: config.appName,
    packageId: config.applicationId,
    startUrl: `${url.pathname}${url.search}`,
  }

  const webManifestUrl = asRemoteUrl(config.webManifestUrl)
  if (webManifestUrl) {
    merged.webManifestUrl = webManifestUrl
  }

  if (config.keystoreAlias || config.keystorePath) {
    merged.signingKey = { alias: config.keystoreAlias, path: config.keystorePath }
  }

  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

/** Reads the keystore location back from `twa-manifest.json`; `undefined` when the file is absent. */
export async function readWebshellProjectConfig(
  projectDirectory: string,
): Promise<SavedWebshellProjectConfig | undefined> {
  const configPath = join(projectDirectory, WEBSHELL_PROJECT_CONFIG_FILENAME)
  const parsed = await readTwaManifest(configPath)
  if (!parsed) {
    return undefined
  }

  const signingKey = asObjectOrUndefined(parsed.signingKey)

  return {
    keystoreAlias: asString(signingKey?.alias),
    keystorePath: asString(signingKey?.path),
  }
}

async function readTwaManifest(configPath: string): Promise<Record<string, unknown> | undefined> {
  let contents: string
  try {
    contents = await readFile(configPath, 'utf8')
  } catch {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${configPath}: ${error instanceof Error ? error.message : error}`)
  }

  return asObjectOrUndefined(parsed)
}

function asRemoteUrl(value: string | undefined): string | undefined {
  return value?.startsWith('http://') || value?.startsWith('https://') ? value : undefined
}

function asObjectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
