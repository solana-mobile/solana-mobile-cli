import { homedir } from 'node:os'
import { join } from 'node:path'

export interface AndroidSdkRootCandidate {
  path: string
  source: string
}

export interface AndroidSdkRootOptions {
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  platform?: NodeJS.Platform
}

/** Where Android Studio installs the SDK when nothing points elsewhere. */
export function defaultAndroidSdkRoot({
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
}: AndroidSdkRootOptions = {}): string {
  switch (platform) {
    case 'darwin':
      return join(homeDirectory, 'Library', 'Android', 'sdk')
    case 'win32':
      return join(environment.LOCALAPPDATA ?? join(homeDirectory, 'AppData', 'Local'), 'Android', 'Sdk')
    default:
      return join(homeDirectory, 'Android', 'Sdk')
  }
}

/**
 * Every location worth checking, most authoritative first. `ANDROID_HOME` outranks the deprecated `ANDROID_SDK_ROOT`,
 * matching Android Studio's own precedence, and the per-platform default closes the list.
 */
export function listAndroidSdkRootCandidates(options: AndroidSdkRootOptions = {}): AndroidSdkRootCandidate[] {
  const environment = options.environment ?? process.env

  return [
    { path: environment.ANDROID_HOME, source: 'ANDROID_HOME' },
    { path: environment.ANDROID_SDK_ROOT, source: 'ANDROID_SDK_ROOT' },
    { path: defaultAndroidSdkRoot({ ...options, environment }), source: 'default location' },
  ].filter((candidate): candidate is AndroidSdkRootCandidate => Boolean(candidate.path))
}

/** The SDK root to use without touching the disk: the first candidate, whether or not it exists. */
export function resolveAndroidSdkRoot(options: AndroidSdkRootOptions = {}): string {
  return (listAndroidSdkRootCandidates(options)[0] as AndroidSdkRootCandidate).path
}
