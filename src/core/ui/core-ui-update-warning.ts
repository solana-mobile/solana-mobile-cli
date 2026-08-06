import type { VersionCheckResult } from '../data-access/version-check.ts'
import { detectPackageRunner, isPackageManagerInvocation } from '../util/format-cli-command.ts'

export function formatUpdateWarning(
  { current, latest }: VersionCheckResult,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return [
    `A new version of solana-mobile is available: ${current} → ${latest}`,
    updateInstruction(environment),
    'Pass --skip-version-check to skip this check.',
  ].join('\n')
}

// A package-manager invocation that is not a package runner is a script or `exec` against a
// project dependency; a global install would leave that dependency behind and add a competing
// binary, so only a bare invocation gets the global install suggestion.
function updateInstruction(environment: NodeJS.ProcessEnv): string {
  const packageRunner = detectPackageRunner(environment)

  if (packageRunner) {
    return `Run ${packageRunner} solana-mobile@latest to use the latest version.`
  }

  if (isPackageManagerInvocation(environment)) {
    return 'Update the solana-mobile dependency in your project to get the latest version.'
  }

  return 'Run npm install -g solana-mobile@latest to update.'
}
