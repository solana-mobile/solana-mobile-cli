import { isAbsolute, join, relative } from 'node:path'
import { isRecord } from './read-expo-project.ts'
import type {
  AndroidGradleConfig,
  AndroidProjectState,
  ExpoProject,
  ReleaseCheckResult,
  ReleaseReport,
} from './release-types.ts'

/** Google Play's ceiling, which the dApp Store inherits by reading the same APK field. */
const MAX_VERSION_CODE = 2_100_000_000
const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/

export const RELEASE_REMINDERS = [
  'Every dApp Store release needs a higher versionCode than the release already published.',
  'Sign dApp Store releases with a dedicated key, not the one used for Google Play.',
]

export interface ReleaseCheckInput {
  android: AndroidProjectState
  gradle?: AndroidGradleConfig
  pathExists: (path: string) => Promise<boolean>
  project: ExpoProject
}

export async function buildReleaseReport(input: ReleaseCheckInput): Promise<ReleaseReport> {
  const { android, gradle, project } = input
  const config = project.config
  const androidConfig = isRecord(config.android) ? config.android : {}

  const checks: ReleaseCheckResult[] = [
    checkAppConfig(project),
    checkAppName(config.name),
    checkAndroidPackage(androidConfig.package),
    checkVersionName(config.version),
    checkVersionCode(androidConfig.versionCode),
    await checkAppIcon(project, input.pathExists),
    checkNativeProject(android, gradle, project.root),
    ...(gradle ? checkNativeDrift(android, gradle, config, androidConfig) : []),
    checkReleaseSigning(android, gradle),
  ]

  return {
    checks,
    project: { android, configSource: project.configSource, framework: 'expo', root: project.root },
    ready: checks.every(({ status }) => status !== 'fail'),
    reminders: RELEASE_REMINDERS,
  }
}

export function getReleaseCheckExitCode(report: ReleaseReport) {
  return report.ready ? 0 : 1
}

function checkAppConfig(project: ExpoProject): ReleaseCheckResult {
  if (project.configSource === 'expo config') {
    return { actual: 'resolved with expo config', name: 'App config', status: 'pass' }
  }

  return {
    actual: 'read from app.json',
    details: ['The Expo CLI is not installed, so plugins that change the config were not applied.'],
    name: 'App config',
    recommendation: "Install the project's dependencies so expo config can resolve the full app config.",
    status: 'warn',
  }
}

function checkAppName(name: unknown): ReleaseCheckResult {
  if (typeof name === 'string' && name.trim()) {
    return { actual: name, name: 'App name', status: 'pass' }
  }

  return {
    actual: 'missing',
    name: 'App name',
    recommendation: 'Set expo.name in the app config.',
    status: 'fail',
  }
}

function checkAndroidPackage(value: unknown): ReleaseCheckResult {
  const name = 'Android package'

  if (typeof value !== 'string' || !value.trim()) {
    return {
      actual: 'missing',
      name,
      recommendation: 'Set expo.android.package to the application id the app is published under.',
      status: 'fail',
    }
  }

  if (!PACKAGE_NAME.test(value)) {
    return {
      actual: `${value} is not a valid application id`,
      name,
      recommendation: 'Use a reverse-DNS application id such as com.example.app for expo.android.package.',
      status: 'fail',
    }
  }

  if (value.startsWith('com.anonymous.')) {
    return {
      actual: `${value} is the placeholder expo prebuild generates`,
      name,
      recommendation: 'Set expo.android.package to an application id you own.',
      status: 'fail',
    }
  }

  return { actual: value, name, status: 'pass' }
}

function checkVersionName(value: unknown): ReleaseCheckResult {
  if (typeof value === 'string' && value.trim()) {
    return { actual: value, name: 'Version name', status: 'pass' }
  }

  return {
    actual: 'missing',
    name: 'Version name',
    recommendation: 'Set expo.version to the version users see, such as 1.0.0.',
    status: 'fail',
  }
}

function checkVersionCode(value: unknown): ReleaseCheckResult {
  const name = 'Version code'

  if (value === undefined) {
    return {
      actual: 'missing',
      name,
      recommendation: 'Set expo.android.versionCode and raise it for every release.',
      status: 'fail',
    }
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_VERSION_CODE) {
    return {
      actual: `${JSON.stringify(value)} is not a whole number from 1 to ${MAX_VERSION_CODE}`,
      name,
      recommendation: 'Set expo.android.versionCode to a positive whole number.',
      status: 'fail',
    }
  }

  return { actual: String(value), name, status: 'pass' }
}

async function checkAppIcon(
  project: ExpoProject,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ReleaseCheckResult> {
  const config = project.config
  const android = isRecord(config.android) ? config.android : {}
  const adaptiveIcon = isRecord(android.adaptiveIcon) ? android.adaptiveIcon : {}
  const icons = [adaptiveIcon.foregroundImage, android.icon, config.icon].filter(
    (icon): icon is string => typeof icon === 'string' && icon.trim() !== '',
  )
  const name = 'App icon'

  if (!icons.length) {
    return {
      actual: 'not configured',
      name,
      recommendation: 'Set expo.icon or expo.android.adaptiveIcon so the app does not ship with the default icon.',
      status: 'warn',
    }
  }

  const missing: string[] = []
  for (const icon of new Set(icons)) {
    if (!(await pathExists(isAbsolute(icon) ? icon : join(project.root, icon)))) {
      missing.push(icon)
    }
  }

  if (missing.length) {
    return {
      actual: `${missing.join(', ')} not found`,
      name,
      recommendation: 'Point the icon settings in the app config at files that exist.',
      status: 'fail',
    }
  }

  return { actual: [...new Set(icons)].join(', '), name, status: 'pass' }
}

function checkNativeProject(
  android: AndroidProjectState,
  gradle: AndroidGradleConfig | undefined,
  root: string,
): ReleaseCheckResult {
  const name = 'Native project'

  if (android === 'missing') {
    return { actual: 'none; expo prebuild generates android/ from the app config', name, status: 'info' }
  }

  if (android === 'generated') {
    return gradle
      ? {
          actual: 'android/ is ignored by git; checking the output of the last expo prebuild',
          details: [relative(root, gradle.path)],
          name,
          status: 'info',
        }
      : { actual: 'android/ is ignored by git; expo prebuild regenerates it', name, status: 'info' }
  }

  if (!gradle) {
    return {
      actual: 'android/ has no app/build.gradle',
      name,
      recommendation: 'Restore android/app/build.gradle, or delete android/ and let expo prebuild generate it.',
      status: 'fail',
    }
  }

  return {
    actual: 'android/ is not ignored by git; Gradle builds from it, not from the app config',
    details: [relative(root, gradle.path)],
    name,
    status: 'info',
  }
}

/**
 * Gradle builds whatever `android/` holds, so the app config can say one thing while the APK says
 * another. Prebuild does not touch a native project again, so a mismatch there fails; a generated one
 * is only stale until the next prebuild, so a mismatch there warns.
 */
function checkNativeDrift(
  android: AndroidProjectState,
  gradle: AndroidGradleConfig,
  config: Record<string, unknown>,
  androidConfig: Record<string, unknown>,
): ReleaseCheckResult[] {
  return [
    compareNativeValue(android, 'Native package', 'applicationId', gradle.applicationId, androidConfig.package),
    compareNativeValue(android, 'Native version name', 'versionName', gradle.versionName, config.version),
    compareNativeValue(android, 'Native version code', 'versionCode', gradle.versionCode, androidConfig.versionCode),
  ]
}

function compareNativeValue(
  android: AndroidProjectState,
  name: string,
  field: string,
  nativeValue: number | string | undefined,
  configValue: unknown,
): ReleaseCheckResult {
  if (nativeValue === undefined) {
    return {
      actual: `${field} in build.gradle is not a literal value`,
      details: ['The value is computed, so it cannot be compared with the app config.'],
      name,
      status: 'warn',
    }
  }

  if (configValue === undefined || nativeValue === configValue) {
    return { actual: String(nativeValue), name, status: 'pass' }
  }

  const actual = `build.gradle has ${nativeValue}, the app config has ${configValue}`
  if (android === 'generated') {
    return {
      actual,
      name,
      recommendation: 'Run expo prebuild --clean to regenerate android/ from the app config.',
      status: 'warn',
    }
  }

  return {
    actual,
    name,
    recommendation: `Make ${field} in android/app/build.gradle match the app config; Gradle uses the build.gradle value.`,
    status: 'fail',
  }
}

/**
 * Reads the signing config from `android/` whenever it exists, including one generated by prebuild:
 * that is where a config plugin that signs release builds leaves its result. Only a project that was
 * never prebuilt has to be judged by the stock template.
 */
function checkReleaseSigning(
  android: AndroidProjectState,
  gradle: AndroidGradleConfig | undefined,
): ReleaseCheckResult {
  const name = 'Release signing'

  if (android === 'missing') {
    return {
      actual: 'not generated yet; the default prebuild template signs release builds with the debug key',
      name,
      recommendation:
        'Sign release builds with your own key, for example with a config plugin; the dApp Store rejects debug-signed APKs.',
      status: 'warn',
    }
  }

  const source = android === 'generated' ? ' (from the last expo prebuild)' : ''
  switch (gradle?.releaseSigning) {
    case 'custom':
      return { actual: `release build type has its own signing config${source}`, name, status: 'pass' }
    case 'debug':
      return {
        actual: `release build type is signed with the debug key${source}`,
        name,
        recommendation:
          android === 'generated'
            ? 'Sign release builds with your own key through a config plugin and run expo prebuild again; the dApp Store rejects debug-signed APKs.'
            : 'Give the release build type in android/app/build.gradle a signing config for your release key; the dApp Store rejects debug-signed APKs.',
        status: 'fail',
      }
    case 'unsigned':
      return {
        actual: `release build type has no signing config${source}`,
        name,
        recommendation: 'Sign the release APK with your own release key before submitting it.',
        status: 'warn',
      }
    default:
      return {
        actual: `signing config of the release build type could not be read${source}`,
        name,
        recommendation: 'Make sure the release build type is signed with your release key, not the debug key.',
        status: 'warn',
      }
  }
}
