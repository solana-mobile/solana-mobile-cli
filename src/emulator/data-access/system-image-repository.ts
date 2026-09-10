import { normalizeSystemImagePackage } from './system-image-package-manager.ts'

/** Google's feed of the Google Play system images, the one the SDK tools read for `sdk list`. */
export const SYSTEM_IMAGE_REPOSITORY_URL =
  'https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-4.xml'

const FETCH_TIMEOUT_MS = 30_000
const REMOTE_PACKAGE_PATTERN = /<remotePackage\s+path="(system-images;[^"]+)"[^>]*>([\s\S]*?)<\/remotePackage>/g
/** The SDK tools list the stable channel unless asked otherwise, so the picker offers the same images they do. */
const STABLE_CHANNEL_REF_PATTERN = /<channelRef\s+ref="channel-0"\s*\/>/

export type TextFetcher = (url: string) => Promise<string>

export interface ListAvailableSystemImagesDependencies {
  fetchText?: TextFetcher
}

export async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
  }

  return response.text()
}

/**
 * Reads the feed instead of running `android sdk list` or `sdkmanager --list`. On Windows both abort on exit
 * (STATUS_STACK_BUFFER_OVERRUN) after printing the listing, so their exit code cannot tell a complete listing from a
 * truncated one, and the feed is what they print anyway. See solana-mobile/solana-mobile-cli#51.
 */
export async function listAvailableSystemImages({
  fetchText = defaultFetchText,
}: ListAvailableSystemImagesDependencies = {}): Promise<string[]> {
  let xml: string

  try {
    xml = await fetchText(SYSTEM_IMAGE_REPOSITORY_URL)
  } catch (error) {
    throw new Error(
      `Could not fetch the Android system image list from ${SYSTEM_IMAGE_REPOSITORY_URL}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const systemImages = parseSystemImageRepository(xml)

  if (systemImages.length === 0) {
    throw new Error(`The Android system image list at ${SYSTEM_IMAGE_REPOSITORY_URL} contains no system images.`)
  }

  return systemImages
}

/** The stable-channel system image packages of a `sys-img2` feed, sorted and without duplicates. */
export function parseSystemImageRepository(xml: string): string[] {
  const systemImages = [...xml.matchAll(REMOTE_PACKAGE_PATTERN)]
    .filter(([, , body]) => STABLE_CHANNEL_REF_PATTERN.test(body as string))
    .map(([, path]) => normalizeSystemImagePackage(path as string))

  return [...new Set(systemImages)].sort((left, right) => left.localeCompare(right))
}
