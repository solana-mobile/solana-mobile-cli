interface InvocationSignals {
  lifecycleEvent?: string
  npmCommand?: string
  userAgent?: string
}

function readInvocationSignals(environment: NodeJS.ProcessEnv): InvocationSignals {
  return {
    lifecycleEvent: environment.npm_lifecycle_event,
    npmCommand: environment.npm_command,
    userAgent: environment.npm_config_user_agent,
  }
}

interface PackageRunner {
  command: string
  matches: (signals: InvocationSignals) => boolean
}

const PACKAGE_RUNNERS: PackageRunner[] = [
  // npm and bun both set npmCommand=exec plus a package-manager-specific lifecycleEvent.
  { command: 'npx', matches: (s) => s.npmCommand === 'exec' && s.lifecycleEvent === 'npx' },
  { command: 'bunx', matches: (s) => s.npmCommand === 'exec' && s.lifecycleEvent === 'bunx' },
  // pnpm dlx and yarn dlx don't set npmCommand/lifecycleEvent, so fall back to userAgent
  // and rule out `pnpm exec`/`pnpm run`/`yarn run`, which do set them.
  {
    command: 'pnpm dlx',
    matches: (s) => Boolean(s.userAgent?.startsWith('pnpm/')) && !s.npmCommand && !s.lifecycleEvent,
  },
  { command: 'yarn dlx', matches: (s) => Boolean(s.userAgent?.startsWith('yarn/')) && !s.lifecycleEvent },
]

function detectPackageRunner(environment: NodeJS.ProcessEnv): string | undefined {
  const signals = readInvocationSignals(environment)
  return PACKAGE_RUNNERS.find(({ matches }) => matches(signals))?.command
}

export function formatCliCommand(command: string, environment: NodeJS.ProcessEnv = process.env): string {
  const packageRunner = detectPackageRunner(environment)
  const invocation = packageRunner ? `${packageRunner} solana-mobile` : 'solana-mobile'

  return `${invocation} ${command}`
}
