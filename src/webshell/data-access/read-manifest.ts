import { readFile as readFileUtf8 } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Bubblewrap truncates launcher names to this length; matching it keeps generated projects interoperable. */
const LAUNCHER_NAME_MAX_LENGTH = 12

export interface WebshellManifestIcon {
  purpose: string[]
  sizes: number[]
  src: string
  type?: string
}

/** Normalized view of a web manifest.json or Bubblewrap twa-manifest.json, as consumed by the init flow. */
export interface WebshellManifest {
  appName?: string
  applicationId?: string
  backgroundColor?: string
  icons?: WebshellManifestIcon[]
  keystoreAlias?: string
  keystorePath?: string
  kind: 'bubblewrap' | 'web'
  source: string
  themeColor?: string
  url?: string
  versionCode?: number
  versionName?: string
  webManifestUrl?: string
}

export interface ReadWebshellManifestDependencies {
  fetchFn?: (url: URL) => Promise<Response>
  readFile?: (path: string) => Promise<string>
}

type JsonObject = Record<string, unknown>

interface LoadedJsonSource {
  baseUrl?: string
  data: unknown
  location: string
}

/** Reads a web manifest.json or Bubblewrap twa-manifest.json from a local path or URL and normalizes it. */
export async function readWebshellManifest(
  source: string,
  {
    fetchFn = (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    readFile = (path) => readFileUtf8(path, 'utf8'),
  }: ReadWebshellManifestDependencies = {},
): Promise<WebshellManifest> {
  const loaded = await loadJsonSource(source, { fetchFn, readFile })
  const manifest = asObject(loaded.data)

  return isBubblewrapManifest(manifest) ? parseBubblewrapManifest(loaded, manifest) : parseWebManifest(loaded, manifest)
}

function parseWebManifest(loaded: LoadedJsonSource, manifest: JsonObject): WebshellManifest {
  return {
    appName: resolveLauncherName(manifest),
    backgroundColor: asString(manifest.background_color),
    icons: parseManifestIcons(manifest.icons, loaded.baseUrl),
    kind: 'web',
    source: loaded.location,
    themeColor: asString(manifest.theme_color),
    url: resolveWebManifestUrl(manifest, loaded.baseUrl),
    webManifestUrl: loaded.location,
  }
}

function parseBubblewrapManifest(loaded: LoadedJsonSource, manifest: JsonObject): WebshellManifest {
  const signingKey = asObjectOrUndefined(manifest.signingKey)

  return {
    applicationId: asString(manifest.packageId) ?? asString(manifest.applicationId),
    appName:
      asString(manifest.launcherName) ??
      asString(manifest.shortName) ??
      asString(manifest.short_name) ??
      asString(manifest.name),
    keystoreAlias: asString(signingKey?.alias),
    keystorePath: asString(signingKey?.path) ?? asString(signingKey?.file),
    kind: 'bubblewrap',
    source: loaded.location,
    url: resolveBubblewrapUrl(manifest, loaded.baseUrl),
    versionCode: asPositiveInteger(manifest.versionCode ?? manifest.appVersionCode ?? manifest.androidVersionCode),
    versionName:
      asString(manifest.versionName) ?? asString(manifest.appVersionName) ?? asString(manifest.androidVersionName),
    webManifestUrl: resolveAssetUrl(asString(manifest.webManifestUrl), loaded.baseUrl),
  }
}

function isBubblewrapManifest(manifest: JsonObject): boolean {
  return Boolean(
    asString(manifest.packageId) ??
      asString(manifest.applicationId) ??
      asString(manifest.launcherName) ??
      asString(manifest.host) ??
      asString(manifest.webManifestUrl) ??
      asString(manifest.generatorApp) ??
      asString(manifest.fallbackType) ??
      (asObjectOrUndefined(manifest.signingKey) ? 'signingKey' : undefined),
  )
}

async function loadJsonSource(
  source: string,
  { fetchFn, readFile }: Required<ReadWebshellManifestDependencies>,
): Promise<LoadedJsonSource> {
  const trimmed = source.trim()
  const parsedUrl = parseUrl(trimmed)

  if (parsedUrl?.protocol === 'http:' || parsedUrl?.protocol === 'https:') {
    const response = await fetchFn(parsedUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${parsedUrl}: ${response.status} ${response.statusText}`)
    }
    const location = parsedUrl.toString()

    return { baseUrl: location, data: parseJson(await response.text(), location), location }
  }

  const absolutePath = parsedUrl?.protocol === 'file:' ? fileURLToPath(parsedUrl) : resolve(trimmed)

  return {
    baseUrl: pathToFileURL(absolutePath).toString(),
    data: parseJson(await readFile(absolutePath), absolutePath),
    location: absolutePath,
  }
}

function parseJson(contents: string, location: string): unknown {
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${location}: ${error instanceof Error ? error.message : error}`)
  }
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function resolveStartUrl(startUrl: string | undefined, baseUrl?: string): string | undefined {
  if (!startUrl) {
    return undefined
  }

  if (startUrl.startsWith('http://') || startUrl.startsWith('https://')) {
    return normalizeHttpUrl(startUrl)
  }

  if (!baseUrl?.startsWith('http://') && !baseUrl?.startsWith('https://')) {
    return undefined
  }

  return normalizeHttpUrl(new URL(startUrl, baseUrl).toString())
}

function resolveWebManifestUrl(manifest: JsonObject, baseUrl?: string): string | undefined {
  const explicitStartUrl = asString(manifest.start_url) ?? asString(manifest.startUrl)

  const resolvedStartUrl = resolveStartUrl(explicitStartUrl, baseUrl)
  if (resolvedStartUrl) {
    return resolvedStartUrl
  }

  if (!baseUrl?.startsWith('http://') && !baseUrl?.startsWith('https://')) {
    return undefined
  }

  return normalizeHttpUrl(new URL('/', baseUrl).toString())
}

function resolveBubblewrapUrl(manifest: JsonObject, baseUrl?: string): string | undefined {
  const explicitStartUrl = asString(manifest.startUrl) ?? asString(manifest.start_url)

  if (explicitStartUrl?.startsWith('http://') || explicitStartUrl?.startsWith('https://')) {
    return normalizeHttpUrl(explicitStartUrl)
  }

  const host = asString(manifest.host)
  if (host) {
    const hostUrl = host.startsWith('http://') || host.startsWith('https://') ? host : `https://${host}`

    return normalizeHttpUrl(new URL(explicitStartUrl ?? '/', hostUrl).toString())
  }

  return resolveStartUrl(explicitStartUrl, baseUrl)
}

function parseManifestIcons(value: unknown, baseUrl?: string): WebshellManifestIcon[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const icons: WebshellManifestIcon[] = []
  for (const entry of value) {
    const icon = asObjectOrUndefined(entry)
    const src = resolveAssetUrl(asString(icon?.src), baseUrl)
    if (!src) {
      continue
    }

    icons.push({
      purpose: parsePurpose(asString(icon?.purpose)),
      sizes: parseSizes(asString(icon?.sizes)),
      src,
      type: asString(icon?.type),
    })
  }

  return icons.length > 0 ? icons : undefined
}

function resolveAssetUrl(value: string | undefined, baseUrl?: string): string | undefined {
  if (!value) {
    return undefined
  }

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://')) {
    return value
  }

  if (!baseUrl) {
    return undefined
  }

  return new URL(value, baseUrl).toString()
}

function resolveLauncherName(manifest: JsonObject): string | undefined {
  const shortName = asString(manifest.short_name) ?? asString(manifest.shortName)
  if (shortName) {
    return shortName
  }

  return asString(manifest.name)?.slice(0, LAUNCHER_NAME_MAX_LENGTH)
}

function normalizeHttpUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Invalid URL: ${value}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL must use http or https: ${value}`)
  }

  return parsed.toString()
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Manifest must be a JSON object')
  }

  return value as JsonObject
}

function asObjectOrUndefined(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as JsonObject
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return undefined
}

function parsePurpose(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function parseSizes(value: string | undefined): number[] {
  if (!value || value === 'any') {
    return []
  }

  return value
    .split(/\s+/)
    .map((part) => {
      const [width, height] = part.toLowerCase().split('x')
      const widthValue = Number.parseInt(width ?? '', 10)
      const heightValue = Number.parseInt(height ?? '', 10)
      if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue)) {
        return undefined
      }

      return Math.max(widthValue, heightValue)
    })
    .filter((size): size is number => size !== undefined)
}
