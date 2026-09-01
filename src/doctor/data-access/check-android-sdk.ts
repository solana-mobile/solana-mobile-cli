import { basename, join } from 'node:path'
import type { DoctorCheckResult } from './doctor-check-result.ts'
import { type DoctorEnvironment, findExecutable, parseVersion, sortVersions } from './doctor-environment.ts'

export type AndroidSdkResolution = { conflict?: string; path?: string; searched: string[]; source?: string }

export async function resolveAndroidSdk(environment: DoctorEnvironment): Promise<AndroidSdkResolution> {
  const home = environment.getHomeDirectory()
  const defaults: Partial<Record<NodeJS.Platform, string>> = {
    darwin: join(home, 'Library', 'Android', 'sdk'),
    linux: join(home, 'Android', 'Sdk'),
    win32: environment.environment.LOCALAPPDATA
      ? join(environment.environment.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
  }
  const candidates = [
    { path: environment.environment.ANDROID_HOME, source: 'ANDROID_HOME' },
    { path: environment.environment.ANDROID_SDK_ROOT, source: 'ANDROID_SDK_ROOT' },
    { path: defaults[environment.getPlatform()], source: 'default location' },
  ].filter((value): value is { path: string; source: string } => Boolean(value.path))
  const homeValue = environment.environment.ANDROID_HOME
  const rootValue = environment.environment.ANDROID_SDK_ROOT
  const conflict =
    homeValue && rootValue && homeValue !== rootValue ? `${homeValue} conflicts with ${rootValue}` : undefined
  for (const candidate of candidates) {
    if (await environment.pathExists(candidate.path)) {
      return {
        conflict,
        path: await environment.resolvePath(candidate.path).catch(() => candidate.path),
        searched: candidates.map(({ path }) => path),
        source: candidate.source,
      }
    }
  }
  return { conflict, searched: candidates.map(({ path }) => path) }
}

export async function checkAndroidSdk(environment: DoctorEnvironment, resolution: AndroidSdkResolution) {
  const checks: DoctorCheckResult[] = []
  checks.push({
    actual: resolution.path ? `${resolution.path} (${resolution.source})` : 'not found',
    category: 'android-sdk',
    details: [`Searched: ${resolution.searched.join(', ') || 'no locations available'}`],
    message: resolution.path
      ? `Resolved Android SDK from ${resolution.source}.`
      : 'No valid Android SDK directory was found.',
    name: 'Android SDK',
    recommendation: resolution.path ? undefined : 'Install the Android SDK or set ANDROID_HOME to its location.',
    status: resolution.path ? 'pass' : 'fail',
  })
  if (resolution.conflict)
    checks.push({
      actual: resolution.conflict,
      category: 'android-sdk',
      message: 'ANDROID_HOME and ANDROID_SDK_ROOT point to different locations.',
      name: 'Android SDK environment',
      recommendation: 'Make ANDROID_HOME and ANDROID_SDK_ROOT point to the same Android SDK.',
      status: 'warn',
    })
  if (!resolution.path) return checks
  checks.push(
    await checkVersionDirectories(
      environment,
      resolution.path,
      'platforms',
      'Android platforms',
      'android-',
      'Install an Android SDK platform through Android Studio SDK Manager.',
    ),
  )
  checks.push(
    await checkVersionDirectories(
      environment,
      resolution.path,
      'build-tools',
      'Build Tools',
      '',
      'Install Android SDK Build Tools through Android Studio SDK Manager.',
    ),
  )
  checks.push(
    await checkTool(
      environment,
      resolution.path,
      'emulator',
      [join(resolution.path, 'emulator')],
      'Emulator',
      'Install Android Emulator through Android Studio SDK Manager.',
      'warn',
    ),
  )
  const commandLineDirectories = await commandLineToolDirectories(environment, resolution.path)
  checks.push(
    await checkTool(
      environment,
      resolution.path,
      'avdmanager',
      commandLineDirectories,
      'avdmanager',
      'Install Android SDK Command-line Tools; avdmanager is needed by solana-mobile emulator create.',
      'warn',
    ),
  )
  checks.push(
    await checkTool(
      environment,
      resolution.path,
      'sdkmanager',
      commandLineDirectories,
      'sdkmanager',
      'Install Android SDK Command-line Tools through Android Studio SDK Manager.',
      'warn',
    ),
  )
  return checks
}

async function checkVersionDirectories(
  environment: DoctorEnvironment,
  sdkRoot: string,
  directory: string,
  name: string,
  prefix: string,
  recommendation: string,
): Promise<DoctorCheckResult> {
  const entries = await environment.listDirectory(join(sdkRoot, directory)).catch(() => [])
  const versions = sortVersions(
    entries
      .map((entry) => (entry.startsWith(prefix) ? entry.slice(prefix.length) : entry))
      .filter((entry) => /^\d+(?:\.\d+)*$/.test(entry)),
  )
  const actual = versions.length
    ? name === 'Android platforms'
      ? versions.map((version) => `API ${version}`).join(', ')
      : (versions.at(-1) ?? '')
    : 'none installed'
  return {
    actual,
    category: 'android-sdk',
    details: versions.map((version) => `${name}: ${version}`),
    message: versions.length
      ? `Detected ${versions.length} installed ${name.toLowerCase()} version(s).`
      : `No ${name} are installed.`,
    name,
    recommendation: versions.length ? undefined : recommendation,
    required: 'at least one installed version',
    status: versions.length ? 'pass' : 'fail',
  }
}

async function commandLineToolDirectories(environment: DoctorEnvironment, sdkRoot: string) {
  const root = join(sdkRoot, 'cmdline-tools')
  const entries = await environment.listDirectory(root).catch(() => [])
  return entries.sort().map((entry) => join(root, entry, 'bin'))
}

async function checkTool(
  environment: DoctorEnvironment,
  sdkRoot: string,
  command: string,
  directories: string[],
  name: string,
  recommendation: string,
  missingStatus: 'fail' | 'warn',
): Promise<DoctorCheckResult> {
  const executable = await findExecutable(command, environment, directories)
  if (!executable)
    return {
      actual: 'not found',
      category: name === 'Emulator' ? 'emulator' : 'android-sdk',
      message: `${name} is not available.`,
      name,
      recommendation,
      status: missingStatus,
    }
  let version: string | undefined
  try {
    const output = await environment.runCommand(executable, ['-version'])
    version = parseVersion(`${output.stdout}\n${output.stderr}`)
  } catch {
    version = undefined
  }
  return {
    actual: version ?? 'available',
    category: name === 'Emulator' ? 'emulator' : 'android-sdk',
    details: [`Executable: ${executable}`, `SDK root: ${sdkRoot}`],
    message: `${name} is available.`,
    name,
    status: 'pass',
  }
}

export function parseAndroidApiLevels(entries: string[]) {
  return sortVersions(
    entries.filter((entry) => /^android-\d+$/.test(entry)).map((entry) => entry.slice('android-'.length)),
  )
}
export function selectHighestBuildToolsVersion(entries: string[]) {
  return sortVersions(entries.filter((entry) => /^\d+(?:\.\d+)*$/.test(entry))).at(-1)
}
export function parseEmulatorVersion(output: string) {
  return output.match(/Android emulator version\s+(\d+(?:\.\d+)*)/i)?.[1] ?? parseVersion(output)
}
export function sdkComponentName(path: string) {
  return basename(path)
}
