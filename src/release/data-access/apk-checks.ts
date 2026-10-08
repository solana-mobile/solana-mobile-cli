import { isDebugCertificate } from './inspect-apk.ts'
import type { ApkInspection, ReleaseCheckResult } from './release-types.ts'

/**
 * Checks a built APK, which is what the dApp Store receives, so its signature is a real pass or fail
 * where the project's signing config can only be read as far as Gradle's text allows.
 */
export function checkApk(
  apk: ApkInspection,
  config: Record<string, unknown>,
  androidConfig: Record<string, unknown>,
): ReleaseCheckResult[] {
  if (!apk.exists) {
    return [
      {
        actual: `${apk.path} not found`,
        name: 'APK',
        recommendation:
          'Pass --apk the path of the release APK Gradle built, such as android/app/build/outputs/apk/release/app-release.apk.',
        status: 'fail',
      },
    ]
  }

  const checks: ReleaseCheckResult[] = [{ actual: apk.path, name: 'APK', status: 'info' }]

  if (apk.missingTools.length) {
    checks.push({
      actual: `${apk.missingTools.join(' and ')} not found, so the APK could not be fully checked`,
      name: 'APK tools',
      recommendation:
        'Install Android SDK Build-Tools through Android Studio SDK Manager, or set ANDROID_HOME to the SDK.',
      status: 'fail',
    })
  }

  // aapt2 and apksigner both rejecting the file means it is not an APK at all, which one row says better
  // than a manifest failure and a signature failure side by side.
  if (apk.badgingError !== undefined && apk.signatureError !== undefined) {
    return [
      {
        actual: `${apk.path} is not a readable APK`,
        details: [...apk.badgingError.split('\n'), ...apk.signatureError.split('\n')],
        name: 'APK',
        recommendation: 'Pass --apk the path of the release APK Gradle built.',
        status: 'fail',
      },
    ]
  }

  if (apk.badgingError) {
    checks.push({
      actual: 'the manifest could not be read',
      details: apk.badgingError.split('\n'),
      name: 'APK manifest',
      recommendation: 'Rebuild the APK; aapt2 could not read it.',
      status: 'fail',
    })
  }

  if (apk.badging) {
    checks.push(
      compareApkValue('APK package', 'android.package', apk.badging.packageName, androidConfig.package),
      compareApkValue('APK version name', 'version', apk.badging.versionName, config.version),
      compareApkValue('APK version code', 'android.versionCode', apk.badging.versionCode, androidConfig.versionCode),
    )

    if (apk.badging.debuggable) {
      checks.push({
        actual: 'the APK is debuggable',
        name: 'APK debuggable',
        recommendation: 'Build the release variant; a debuggable APK is a debug build.',
        status: 'fail',
      })
    }
  }

  if (apk.signatureError !== undefined || apk.signers) {
    checks.push(checkApkSignature(apk))
  }

  return checks
}

function compareApkValue(
  name: string,
  field: string,
  apkValue: number | string | undefined,
  configValue: unknown,
): ReleaseCheckResult {
  if (apkValue === undefined) {
    return { actual: 'missing from the APK manifest', name, status: 'fail' }
  }

  if (configValue === undefined || apkValue === configValue) {
    return { actual: String(apkValue), name, status: 'pass' }
  }

  return {
    actual: `the APK has ${apkValue}, the app config has ${configValue}`,
    name,
    recommendation: `Rebuild the APK from the current app config; its ${field} does not match.`,
    status: 'fail',
  }
}

function checkApkSignature(apk: ApkInspection): ReleaseCheckResult {
  const name = 'APK signature'
  const signers = apk.signers ?? []

  // apksigner's exit code decides whether the signature verifies; its signer lines only say by whom.
  if (apk.signatureError === undefined && !signers.length) {
    return {
      actual: 'apksigner verified the APK, but its signer could not be read',
      name,
      recommendation:
        'Run apksigner verify --print-certs on the APK and make sure it is not signed with the Android debug certificate.',
      status: 'warn',
    }
  }

  if (apk.signatureError !== undefined) {
    return {
      actual: 'the APK is not signed, or its signature does not verify',
      details: apk.signatureError?.split('\n'),
      name,
      recommendation: 'Sign the APK with your release key; the dApp Store only accepts signed APKs.',
      status: 'fail',
    }
  }

  const details = signers.flatMap(({ sha256 }) => (sha256 ? [`SHA-256 ${sha256}`] : []))
  if (signers.some(isDebugCertificate)) {
    return {
      actual: 'signed with the Android debug certificate',
      details,
      name,
      recommendation: 'Sign the APK with your release key; the dApp Store rejects debug-signed APKs.',
      status: 'fail',
    }
  }

  return { actual: `signed by ${signers.map(({ dn }) => dn).join('; ')}`, details, name, status: 'pass' }
}
