export type ReleaseCheckStatus = 'fail' | 'info' | 'pass' | 'warn'

export interface ReleaseCheckResult {
  actual: string
  details?: string[]
  name: string
  recommendation?: string
  status: ReleaseCheckStatus
}

export interface ReleaseCheckCommandOptions {
  directory?: string
  json?: boolean
  verbose?: boolean
}

/**
 * What `android/` is. `native` is a directory git does not ignore, which Gradle builds as is and
 * prebuild leaves alone; `generated` is one git ignores, which prebuild regenerates from the app config;
 * `missing` means prebuild has not run.
 */
export type AndroidProjectState = 'generated' | 'missing' | 'native'

/** `expo config` evaluates dynamic `app.config.*` files; `app.json` is read directly when the Expo CLI is not installed. */
export type ExpoConfigSource = 'app.json' | 'expo config'

export interface ExpoProject {
  config: Record<string, unknown>
  configSource: ExpoConfigSource
  root: string
}

export type AndroidReleaseSigning = 'custom' | 'debug' | 'unknown' | 'unsigned'

/** The values read from `android/app/build.gradle(.kts)`. Only literal values are read; anything computed is undefined. */
export interface AndroidGradleConfig {
  applicationId?: string
  path: string
  releaseSigning: AndroidReleaseSigning
  versionCode?: number
  versionName?: string
}

export interface ReleaseReport {
  checks: ReleaseCheckResult[]
  project: {
    android: AndroidProjectState
    configSource: ExpoConfigSource
    framework: 'expo'
    root: string
  }
  ready: boolean
  reminders: string[]
}
