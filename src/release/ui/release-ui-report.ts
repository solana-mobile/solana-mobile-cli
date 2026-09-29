import type { ReleaseCheckResult, ReleaseCheckStatus, ReleaseReport } from '../data-access/release-types.ts'

const styles = {
  fail: ['\u001b[31m', '\u001b[39m'],
  heading: ['\u001b[1m', '\u001b[22m'],
  info: ['\u001b[36m', '\u001b[39m'],
  muted: ['\u001b[2m', '\u001b[22m'],
  pass: ['\u001b[32m', '\u001b[39m'],
  warn: ['\u001b[33m', '\u001b[39m'],
} as const

const symbols: Record<ReleaseCheckStatus, string> = { fail: '✗', info: '•', pass: '✓', warn: '!' }

export function renderReleaseReport(report: ReleaseReport, verbose = false) {
  process.stdout.write(`${formatReleaseReport(report, verbose, Boolean(process.stdout.isTTY))}\n`)
}

export function formatReleaseReport(report: ReleaseReport, verbose = false, color = false) {
  const output = [
    paint('Solana Mobile Release Check', 'heading', color),
    paint(`Expo project at ${report.project.root}`, 'muted', color),
    '',
    ...formatChecks(report.checks, verbose, color),
  ]

  const recommendations = listRecommendations(report.checks)
  if (recommendations.length) {
    output.push('', paint('Recommendations', 'heading', color))
    for (const { recommendation, status } of recommendations)
      output.push(`  ${paint(symbols[status], status, color)} ${recommendation}`)
  }

  output.push('', paint('dApp Store', 'heading', color))
  for (const reminder of report.reminders) output.push(`  ${paint(symbols.info, 'info', color)} ${reminder}`)

  output.push('', formatVerdict(report, color))

  return output.join('\n')
}

/** Each recommendation once, marked like the most severe check that asks for it. */
function listRecommendations(checks: ReleaseCheckResult[]) {
  const recommendations = new Map<string, ReleaseCheckStatus>()
  for (const { recommendation, status } of checks) {
    if (recommendation && recommendations.get(recommendation) !== 'fail') recommendations.set(recommendation, status)
  }

  return [...recommendations].map(([recommendation, status]) => ({ recommendation, status }))
}

// A warning is something the check could not rule out, such as a signing setup it cannot read, so a
// report with warnings does not get the unqualified green verdict even though it exits 0.
function formatVerdict(report: ReleaseReport, color: boolean) {
  const failures = count(report.checks, 'fail')
  if (failures) {
    return `${paint(symbols.fail, 'fail', color)} Not ready for a dApp Store release: ${plural(failures, 'check')} failed.`
  }

  const warnings = count(report.checks, 'warn')
  if (warnings) {
    return `${paint(symbols.warn, 'warn', color)} No checks failed, but ${plural(warnings, 'warning')} ${warnings === 1 ? 'needs' : 'need'} a look before submitting to the dApp Store.`
  }

  return `${paint(symbols.pass, 'pass', color)} Ready to build a dApp Store release.`
}

function count(checks: ReleaseCheckResult[], status: ReleaseCheckStatus) {
  return checks.filter((check) => check.status === status).length
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

function formatChecks(checks: ReleaseCheckResult[], verbose: boolean, color: boolean) {
  const labelWidth = Math.max(...checks.map(({ name }) => name.length))
  return checks.flatMap((check) => {
    const line = `  ${paint(symbols[check.status], check.status, color)} ${check.name.padEnd(labelWidth)}  ${check.actual}`
    if (!verbose || !check.details?.length) return [line]
    return [line, ...check.details.map((detail) => `    ${' '.repeat(labelWidth)}  ${paint(detail, 'muted', color)}`)]
  })
}

function paint(value: string, style: keyof typeof styles, color: boolean) {
  if (!color) return value
  const [open, close] = styles[style]
  return `${open}${value}${close}`
}
