import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '@clack/prompts'
import type { WebshellManifest, WebshellManifestIcon } from './read-manifest.ts'

const DEFAULT_ICON_BACKGROUND = '#3DDC84'
const DEFAULT_SPLASH_BACKGROUND = '#3DDC84'
const FOREGROUND_RESOURCE_NAME = 'ic_launcher_foreground_inner'
const SUPPORTED_ICON_EXTENSIONS = new Set(['png', 'webp', 'jpg', 'jpeg'])

export type WebshellBrandingSeed = Pick<WebshellManifest, 'backgroundColor' | 'icons' | 'themeColor'>

export interface ApplyWebshellBrandingDependencies {
  fetchFn?: (url: URL) => Promise<Response>
  logWarning?: (message: string) => void
}

interface DownloadedIcon {
  buffer: Buffer
  extension: string
}

/**
 * Applies the web app's branding to a generated project: splash/launcher colors from the manifest's
 * theme and background colors, and the preferred manifest icon as the adaptive launcher foreground.
 * A missing or failing icon degrades to the template's default artwork with a warning — branding
 * problems never fail init.
 */
export async function applyWebshellBranding(
  projectDirectory: string,
  manifest?: WebshellBrandingSeed,
  {
    fetchFn = (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    logWarning = log.warn,
  }: ApplyWebshellBrandingDependencies = {},
): Promise<void> {
  const splashBackground =
    normalizeAndroidColor(manifest?.backgroundColor) ??
    normalizeAndroidColor(manifest?.themeColor) ??
    DEFAULT_SPLASH_BACKGROUND
  const iconBackground =
    normalizeAndroidColor(manifest?.themeColor) ??
    normalizeAndroidColor(manifest?.backgroundColor) ??
    DEFAULT_ICON_BACKGROUND

  await writeColors(projectDirectory, splashBackground, iconBackground)
  await writeLauncherBackground(projectDirectory)

  const selectedIcon = selectPreferredManifestIcon(manifest?.icons)
  if (!selectedIcon) {
    return
  }

  const downloadedIcon = await downloadManifestIconSafely(selectedIcon.src, fetchFn, logWarning)
  if (!downloadedIcon) {
    logWarning(`Failed to import manifest icon ${selectedIcon.src}. Using the default Android launcher icon instead.`)
    return
  }

  await writeLauncherForeground(projectDirectory, downloadedIcon.extension)
  await clearPreviousForegroundAssets(projectDirectory, downloadedIcon.extension)

  const drawableNodpiDirectory = join(projectDirectory, 'app', 'src', 'main', 'res', 'drawable-nodpi')
  await mkdir(drawableNodpiDirectory, { recursive: true })
  await writeFile(
    join(drawableNodpiDirectory, `${FOREGROUND_RESOURCE_NAME}.${downloadedIcon.extension}`),
    downloadedIcon.buffer,
  )
}

function selectPreferredManifestIcon(icons: WebshellManifestIcon[] | undefined): WebshellManifestIcon | undefined {
  if (!icons?.length) {
    return undefined
  }

  const rankedIcons = [...icons]
    .filter((icon) => isSupportedIconSource(icon.src, icon.type))
    .sort((left, right) => {
      const purposeDelta = purposeScore(right.purpose) - purposeScore(left.purpose)
      if (purposeDelta !== 0) {
        return purposeDelta
      }

      return largestDeclaredSize(right.sizes) - largestDeclaredSize(left.sizes)
    })

  return rankedIcons[0]
}

function purposeScore(purpose: string[]): number {
  // Adaptive icons and the native splash screen both crop the foreground asset,
  // so prefer maskable artwork when it is available.
  if (purpose.includes('maskable')) {
    return 2
  }
  if (purpose.length === 0 || purpose.includes('any')) {
    return 1
  }

  return 0
}

function largestDeclaredSize(sizes: number[]): number {
  return sizes.reduce((largest, size) => Math.max(largest, size), 0)
}

function isSupportedIconSource(source: string, type?: string): boolean {
  if (source.startsWith('data:')) {
    return false
  }

  return detectImageExtension(source, type) !== undefined
}

async function downloadManifestIcon(
  source: string,
  fetchFn: (url: URL) => Promise<Response>,
): Promise<DownloadedIcon | undefined> {
  if (source.startsWith('file://')) {
    const extension = detectImageExtension(source)
    if (!extension) {
      return undefined
    }

    return {
      buffer: await readFile(fileURLToPath(source)),
      extension,
    }
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetchFn(new URL(source))
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest icon ${source}: ${response.status} ${response.statusText}`)
    }

    const extension = detectImageExtension(source, response.headers.get('content-type') ?? undefined)
    if (!extension) {
      return undefined
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      extension,
    }
  }

  return undefined
}

async function downloadManifestIconSafely(
  source: string,
  fetchFn: (url: URL) => Promise<Response>,
  logWarning: (message: string) => void,
): Promise<DownloadedIcon | undefined> {
  try {
    return await downloadManifestIcon(source, fetchFn)
  } catch (error) {
    if (error instanceof Error) {
      logWarning(error.message)
      return undefined
    }
    throw error
  }
}

function detectImageExtension(source: string, type?: string): string | undefined {
  const normalizedType = type?.toLowerCase()
  if (normalizedType) {
    if (normalizedType.includes('png')) {
      return 'png'
    }
    if (normalizedType.includes('webp')) {
      return 'webp'
    }
    if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) {
      return 'jpg'
    }
  }

  const withoutQuery = source.split('?')[0]?.split('#')[0] ?? source
  const extension = extname(withoutQuery).replace('.', '').toLowerCase()
  if (SUPPORTED_ICON_EXTENSIONS.has(extension)) {
    return extension
  }

  return undefined
}

async function writeColors(projectDirectory: string, splashBackground: string, iconBackground: string): Promise<void> {
  const colorsPath = join(projectDirectory, 'app', 'src', 'main', 'res', 'values', 'colors.xml')
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="launcher_icon_background">${iconBackground}</color>
    <color name="splash_background">${splashBackground}</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`
  await writeFile(colorsPath, contents, 'utf8')
}

async function writeLauncherBackground(projectDirectory: string): Promise<void> {
  const backgroundPath = join(projectDirectory, 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_background.xml')
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/launcher_icon_background" />
</shape>
`
  await writeFile(backgroundPath, contents, 'utf8')
}

async function writeLauncherForeground(projectDirectory: string, extension: string): Promise<void> {
  const foregroundXmlPath = join(
    projectDirectory,
    'app',
    'src',
    'main',
    'res',
    'drawable',
    'ic_launcher_foreground.xml',
  )
  const contents = `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/${FOREGROUND_RESOURCE_NAME}"
    android:insetBottom="18dp"
    android:insetLeft="18dp"
    android:insetRight="18dp"
    android:insetTop="18dp" />
`
  await writeFile(foregroundXmlPath, contents, 'utf8')

  const foregroundAssetDirectory = join(projectDirectory, 'app', 'src', 'main', 'res', 'drawable-nodpi')
  await mkdir(foregroundAssetDirectory, { recursive: true })

  for (const candidateExtension of SUPPORTED_ICON_EXTENSIONS) {
    if (candidateExtension === extension) {
      continue
    }
    await rm(join(foregroundAssetDirectory, `${FOREGROUND_RESOURCE_NAME}.${candidateExtension}`), { force: true })
  }
}

async function clearPreviousForegroundAssets(projectDirectory: string, currentExtension: string): Promise<void> {
  const drawableNodpiDirectory = join(projectDirectory, 'app', 'src', 'main', 'res', 'drawable-nodpi')
  await mkdir(drawableNodpiDirectory, { recursive: true })
  const entries = await readdir(drawableNodpiDirectory)
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${FOREGROUND_RESOURCE_NAME}.`) && !entry.endsWith(`.${currentExtension}`))
      .map((entry) => rm(join(drawableNodpiDirectory, entry), { force: true })),
  )
}

function normalizeAndroidColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  // CSS hex colors carry the alpha channel last (#RRGGBBAA, #RGBA); Android expects it first (#AARRGGBB).
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    const body = trimmed.slice(1)
    return `#${body.slice(6, 8)}${body.slice(0, 6)}`.toUpperCase()
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [red, green, blue] = trimmed.slice(1).split('')
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase()
  }
  if (/^#[0-9a-fA-F]{4}$/.test(trimmed)) {
    const [red, green, blue, alpha] = trimmed.slice(1).split('')
    return `#${alpha}${alpha}${red}${red}${green}${green}${blue}${blue}`.toUpperCase()
  }

  return undefined
}
