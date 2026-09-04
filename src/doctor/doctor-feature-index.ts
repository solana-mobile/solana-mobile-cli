import { checkAdbVersion } from './data-access/check-adb-version.ts'
import { checkAndroidDevices, checkEmulatorAcceleration } from './data-access/check-android-devices.ts'
import { checkAndroidSdk, resolveAndroidSdk } from './data-access/check-android-sdk.ts'
import { checkJava } from './data-access/check-java.ts'
import { checkNodeVersion } from './data-access/check-node-version.ts'
import {
  checkDiskSpace,
  checkOperatingSystem,
  checkPackageManagers,
} from './data-access/check-system-and-javascript.ts'
import type { DoctorReport } from './data-access/doctor-check-result.ts'
import { type DoctorEnvironment, defaultDoctorEnvironment } from './data-access/doctor-environment.ts'
import { buildDoctorReport, getDoctorExitCode } from './data-access/doctor-report.ts'
import { renderDoctorReport } from './ui/doctor-ui-report.ts'

export type DoctorCommandOptions = { json?: boolean; verbose?: boolean }

async function createDoctorReport(environment: DoctorEnvironment = defaultDoctorEnvironment): Promise<DoctorReport> {
  const [disk, packageManagers, java] = await Promise.all([
    checkDiskSpace(environment),
    checkPackageManagers(environment),
    checkJava(environment),
  ])
  const sdkResolution = await resolveAndroidSdk(environment)
  const [sdkChecks, adb, acceleration] = await Promise.all([
    checkAndroidSdk(environment, sdkResolution),
    checkAdbVersion(environment, sdkResolution.path),
    checkEmulatorAcceleration(environment),
  ])
  const deviceChecks = await checkAndroidDevices(environment, adb.status === 'pass', sdkResolution.path)
  const checks = [
    checkOperatingSystem(environment),
    disk,
    checkNodeVersion(),
    packageManagers,
    ...java,
    ...sdkChecks,
    adb,
    acceleration,
    ...deviceChecks,
  ]
  return buildDoctorReport(checks)
}

export async function runDoctor(options: DoctorCommandOptions = {}) {
  const report = await createDoctorReport()
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else renderDoctorReport(report, options.verbose)
  return getDoctorExitCode(report)
}
