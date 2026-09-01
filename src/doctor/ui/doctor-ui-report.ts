import type {
  DoctorCheckCategory,
  DoctorCheckResult,
  DoctorCheckStatus,
  DoctorReport,
} from '../data-access/doctor-check-result.ts'

const sections: { categories: DoctorCheckCategory[]; checks: string[]; title: string }[] = [
  { categories: ['system'], checks: ['Operating system', 'Disk space'], title: 'System' },
  { categories: ['javascript'], checks: ['Node.js', 'Package managers'], title: 'JavaScript' },
  { categories: ['java'], checks: ['Java', 'Java compiler', 'JAVA_HOME'], title: 'Java' },
  {
    categories: ['android-sdk'],
    checks: [
      'Android SDK',
      'Android SDK environment',
      'Android platforms',
      'Build Tools',
      'adb',
      'sdkmanager',
      'avdmanager',
    ],
    title: 'Android SDK',
  },
  {
    categories: ['emulator', 'device'],
    checks: ['Emulator', 'Android emulators', 'Running emulators', 'Emulator acceleration', 'Physical devices'],
    title: 'Devices',
  },
]

const styles = {
  fail: ['\u001b[31m', '\u001b[39m'],
  heading: ['\u001b[1m', '\u001b[22m'],
  info: ['\u001b[36m', '\u001b[39m'],
  muted: ['\u001b[2m', '\u001b[22m'],
  pass: ['\u001b[32m', '\u001b[39m'],
  warn: ['\u001b[33m', '\u001b[39m'],
} as const

const symbols: Record<DoctorCheckStatus, string> = { fail: '✗', info: '•', pass: '✓', warn: '!' }

export function renderDoctorReport(report: DoctorReport, verbose = false) {
  process.stdout.write(`${formatDoctorReport(report, verbose, Boolean(process.stdout.isTTY))}\n`)
}

export function formatDoctorReport(report: DoctorReport, verbose = false, color = false) {
  const output = [paint('Solana Mobile Doctor', 'heading', color)]

  for (const section of sections) {
    const checks = report.checks
      .filter(({ category }) => section.categories.includes(category))
      .sort((left, right) => checkOrder(section.checks, left.name) - checkOrder(section.checks, right.name))
    if (!checks.length) continue
    output.push('', paint(section.title, 'heading', color), ...formatChecks(checks, verbose, color))
  }

  const readiness: DoctorCheckResult[] = [
    capability('Project creation', report.capabilities.projectCreation),
    capability('Android build', report.capabilities.androidBuild),
    capability('Emulator workflow', report.capabilities.emulator),
    capability('Physical device workflow', report.capabilities.physicalDevice),
  ]
  output.push('', paint('Readiness', 'heading', color), ...formatChecks(readiness, false, color))

  if (report.recommendations.length) {
    output.push('', paint('Recommendations', 'heading', color))
    for (const { name, recommendation } of recommendationChecks(report))
      output.push(`  ${paint('!', 'warn', color)} ${name}: ${recommendation}`)
  }

  const summaryStatus = report.ready ? 'pass' : report.capabilities.projectCreation ? 'warn' : 'fail'
  output.push('', `${paint(symbols[summaryStatus], summaryStatus, color)} ${finalMessage(report)}`)
  return output.join('\n')
}

function capability(name: string, ready: boolean): DoctorCheckResult {
  return {
    actual: ready ? 'ready' : 'unavailable',
    category: 'system',
    message: '',
    name,
    status: ready ? 'pass' : 'info',
  }
}

function checkOrder(order: string[], name: string) {
  const index = order.indexOf(name)
  return index === -1 ? order.length : index
}

function finalMessage(report: DoctorReport) {
  if (report.capabilities.projectCreation && report.capabilities.androidBuild)
    return 'Ready for Solana Mobile development.'
  if (report.capabilities.projectCreation) return 'Project creation is ready; the Android environment needs attention.'
  return 'Not ready for Solana Mobile development.'
}

function formatChecks(checks: DoctorCheckResult[], verbose: boolean, color: boolean) {
  const labelWidth = Math.max(...checks.map(({ name }) => name.length))
  return checks.flatMap((check) => {
    const requirement = check.status === 'pass' || !check.required ? '' : ` (requires ${check.required})`
    const line = `  ${paint(symbols[check.status], check.status, color)} ${check.name.padEnd(labelWidth)}  ${check.actual}${requirement}`
    if (!verbose || !check.details?.length) return [line]
    return [line, ...check.details.map((detail) => `    ${' '.repeat(labelWidth)}  ${paint(detail, 'muted', color)}`)]
  })
}

function paint(value: string, style: keyof typeof styles, color: boolean) {
  if (!color) return value
  const [open, close] = styles[style]
  return `${open}${value}${close}`
}

function recommendationChecks(report: DoctorReport) {
  const seen = new Set<string>()
  return report.checks.filter(({ recommendation }) => {
    if (!recommendation || seen.has(recommendation)) return false
    seen.add(recommendation)
    return true
  }) as (DoctorCheckResult & { recommendation: string })[]
}
