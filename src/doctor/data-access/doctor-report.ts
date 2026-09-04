import type { DoctorCapabilities, DoctorCheckResult, DoctorReport } from './doctor-check-result.ts'

export function buildDoctorReport(checks: DoctorCheckResult[]): DoctorReport {
  const capabilities = deriveCapabilities(checks)
  return {
    capabilities,
    checks,
    ready: capabilities.projectCreation && capabilities.androidBuild,
    recommendations: [...new Set(checks.flatMap(({ recommendation }) => (recommendation ? [recommendation] : [])))],
  }
}

export function deriveCapabilities(checks: DoctorCheckResult[]): DoctorCapabilities {
  const passes = (name: string) => checks.some((check) => check.name === name && check.status === 'pass')
  const androidBuild = ['Android SDK', 'Android platforms', 'Build Tools', 'Java', 'Java compiler', 'adb'].every(passes)
  const projectCreation = ['Node.js', 'Package managers'].every(passes)
  return {
    androidBuild,
    emulator: androidBuild && ['Android emulators', 'Emulator', 'avdmanager'].every(passes),
    physicalDevice: androidBuild && passes('Physical devices'),
    projectCreation,
  }
}

export function getDoctorExitCode(report: DoctorReport) {
  return report.checks.some(({ status }) => status === 'fail') ? 1 : 0
}
