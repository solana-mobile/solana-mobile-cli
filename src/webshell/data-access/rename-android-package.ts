import { access, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

/** The hardcoded Kotlin package the vendored template ships with. */
export const WEBSHELL_TEMPLATE_PACKAGE_NAME = 'com.example.webshell'

/**
 * Package segments that are valid in an Android application id but reserved words in Kotlin/Java,
 * so they cannot appear in a package declaration without being rewritten.
 */
const RESERVED_PACKAGE_SEGMENTS = new Set([
  'abstract',
  'annotation',
  'as',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'companion',
  'const',
  'constructor',
  'continue',
  'data',
  'default',
  'do',
  'double',
  'dynamic',
  'else',
  'enum',
  'exports',
  'extends',
  'external',
  'false',
  'field',
  'final',
  'finally',
  'float',
  'for',
  'fun',
  'get',
  'goto',
  'if',
  'implements',
  'import',
  'in',
  'infix',
  'init',
  'instanceof',
  'int',
  'interface',
  'internal',
  'is',
  'java',
  'long',
  'module',
  'native',
  'new',
  'null',
  'object',
  'open',
  'operator',
  'out',
  'override',
  'package',
  'private',
  'protected',
  'public',
  'record',
  'reified',
  'requires',
  'return',
  'sealed',
  'set',
  'short',
  'static',
  'strictfp',
  'super',
  'suspend',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'transitive',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'void',
  'volatile',
  'when',
  'while',
  'yield',
])

export interface RenameAndroidPackageOptions {
  applicationId: string
  appName: string
  keystoreAlias?: string
  keystorePath?: string
  projectName: string
  url: string
  versionCode: number
  versionName: string
}

export interface DerivedWebshellPackageName {
  note?: string
  packageName: string
}

export function validateWebshellApplicationId(value: string): string | undefined {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value)) {
    return 'Application ID must look like com.example.app. Use lowercase package segments with letters, numbers, or underscores only; dashes (-) are not allowed.'
  }

  return undefined
}

/**
 * The Android application id and the Kotlin package usually match, but an application id may contain
 * segments that are reserved words in Kotlin/Java (`fun.cfl.www` is a valid id). Those segments are
 * prefixed with an underscore in the package/namespace while the application id stays untouched.
 */
export function deriveWebshellPackageName(applicationId: string): DerivedWebshellPackageName {
  const segmentResults = applicationId
    .trim()
    .split('.')
    .map((segment) => normalizeApplicationIdSegment(segment))
  const segments = segmentResults
    .map((result) => result.normalized)
    .filter((segment): segment is string => Boolean(segment))

  const packageName = segments.join('.')
  const reservedRewrite = segmentResults.find((result) => result.reason === 'reserved')
  if (reservedRewrite?.original) {
    return {
      note:
        `The Kotlin package/namespace will use ${packageName} because ` +
        `"${reservedRewrite.original}" is a reserved word in Kotlin/Java.`,
      packageName,
    }
  }

  const normalizedRewrite = segmentResults.some((result) => result.adjusted)
  if (normalizedRewrite) {
    return {
      note: `The Kotlin package/namespace will use ${packageName} to keep it code-safe.`,
      packageName,
    }
  }

  return { packageName }
}

/**
 * Rewrites the copied template for the requested application id: Gradle properties (`SOLANA_MOBILE_*`
 * keys), root project name, `android.namespace`, the launcher label, Kotlin package declarations and
 * imports, and the Kotlin source tree location. Also writes the generated project's README.
 */
export async function renameAndroidPackage(
  projectDirectory: string,
  options: RenameAndroidPackageOptions,
): Promise<void> {
  const validationError = validateWebshellApplicationId(options.applicationId)
  if (validationError) {
    throw new Error(validationError)
  }

  const { packageName } = deriveWebshellPackageName(options.applicationId)

  await rewriteGradleProperties(projectDirectory, options)
  await rewriteSettings(projectDirectory, options.projectName)
  await rewriteAppBuildScript(projectDirectory, packageName)
  await rewriteStrings(projectDirectory, options.appName)
  await rewritePackageDeclarations(projectDirectory, packageName)
  await relocatePackageDirectories(projectDirectory, packageName)
  await writeProjectReadme(projectDirectory, options, packageName)
}

async function rewriteGradleProperties(projectDirectory: string, options: RenameAndroidPackageOptions): Promise<void> {
  const gradlePropertiesPath = join(projectDirectory, 'gradle.properties')
  let contents = await readFile(gradlePropertiesPath, 'utf8')
  contents = updateGradleProperty(contents, 'SOLANA_MOBILE_URL', options.url)
  contents = updateGradleProperty(contents, 'SOLANA_MOBILE_APPLICATION_ID', options.applicationId)
  contents = updateGradleProperty(contents, 'SOLANA_MOBILE_VERSION_CODE', String(options.versionCode))
  contents = updateGradleProperty(contents, 'SOLANA_MOBILE_VERSION_NAME', options.versionName)
  await writeFile(gradlePropertiesPath, contents, 'utf8')
}

async function rewriteSettings(projectDirectory: string, projectName: string): Promise<void> {
  const settingsPath = join(projectDirectory, 'settings.gradle.kts')
  const contents = await readFile(settingsPath, 'utf8')
  const escapedName = projectName.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  await writeFile(
    settingsPath,
    contents.replace(/rootProject\.name\s*=\s*"[^"]*"/, `rootProject.name = "${escapedName}"`),
    'utf8',
  )
}

async function rewriteAppBuildScript(projectDirectory: string, packageName: string): Promise<void> {
  const buildScriptPath = join(projectDirectory, 'app', 'build.gradle.kts')
  const contents = await readFile(buildScriptPath, 'utf8')
  await writeFile(buildScriptPath, contents.replace(/namespace\s*=\s*"[^"]+"/, `namespace = "${packageName}"`), 'utf8')
}

async function rewriteStrings(projectDirectory: string, appName: string): Promise<void> {
  const stringsPath = join(projectDirectory, 'app', 'src', 'main', 'res', 'values', 'strings.xml')
  const contents = await readFile(stringsPath, 'utf8')
  await writeFile(
    stringsPath,
    contents.replace(
      /<string name="app_name">.*?<\/string>/,
      `<string name="app_name">${escapeXmlText(appName)}</string>`,
    ),
    'utf8',
  )
}

async function rewritePackageDeclarations(projectDirectory: string, packageName: string): Promise<void> {
  for (const sourceRoot of kotlinSourceRoots(projectDirectory)) {
    if (!(await exists(sourceRoot))) {
      continue
    }

    for (const filePath of await walkFiles(sourceRoot)) {
      if (!filePath.endsWith('.kt')) {
        continue
      }
      const contents = await readFile(filePath, 'utf8')
      await writeFile(filePath, contents.replaceAll(WEBSHELL_TEMPLATE_PACKAGE_NAME, packageName), 'utf8')
    }
  }
}

async function relocatePackageDirectories(projectDirectory: string, packageName: string): Promise<void> {
  if (packageName === WEBSHELL_TEMPLATE_PACKAGE_NAME) {
    return
  }

  for (const sourceRoot of kotlinSourceRoots(projectDirectory)) {
    const sourceDirectory = join(sourceRoot, ...WEBSHELL_TEMPLATE_PACKAGE_NAME.split('.'))
    if (!(await exists(sourceDirectory))) {
      continue
    }

    // Staged outside every package path first: a destination that equals or contains the source
    // (e.g. an applicationId of com.example) would otherwise delete the sources before the rename.
    const stagingDirectory = join(sourceRoot, '.webshell-staging')
    await rename(sourceDirectory, stagingDirectory)

    const destinationDirectory = join(sourceRoot, ...packageName.split('.'))
    if (await exists(destinationDirectory)) {
      await rm(destinationDirectory, { force: true, recursive: true })
    }
    await mkdir(dirname(destinationDirectory), { recursive: true })
    await rename(stagingDirectory, destinationDirectory)
    await removeEmptyParents(dirname(sourceDirectory), sourceRoot)
  }
}

async function writeProjectReadme(
  projectDirectory: string,
  options: RenameAndroidPackageOptions,
  packageName: string,
): Promise<void> {
  const signingSection =
    options.keystorePath && options.keystoreAlias
      ? `## Release Signing

Saved from CLI configuration:

- Keystore path: \`${options.keystorePath}\`
- Key alias: \`${options.keystoreAlias}\`
- Store password env: \`SOLANA_MOBILE_KEYSTORE_PASSWORD\`
- Key password env: \`SOLANA_MOBILE_KEY_PASSWORD\`

Export the password environment variables before running the CLI release build.

`
      : ''

  const contents = `# ${options.appName}

Generated by the Solana Mobile CLI.

## Configuration

- Web URL: \`${options.url}\`
- Application ID: \`${options.applicationId}\`
- Version code: \`${options.versionCode}\`
- Version name: \`${options.versionName}\`
- Kotlin package / namespace: \`${packageName}\`

## Build

\`\`\`bash
solana-mobile webshell build .
adb install -r app/build/outputs/apk/release/app-release.apk
\`\`\`

${signingSection}## Notes

- This project is a WebView-based Android shell, not a Trusted Web Activity.
- External links outside the configured host open in the system browser.
- Solana wallet intents are handled natively by the app shell.
`

  await writeFile(join(projectDirectory, 'README.md'), contents, 'utf8')
}

function kotlinSourceRoots(projectDirectory: string): string[] {
  return [
    join(projectDirectory, 'app', 'src', 'main', 'java'),
    join(projectDirectory, 'app', 'src', 'test', 'java'),
    join(projectDirectory, 'app', 'src', 'androidTest', 'java'),
  ]
}

function updateGradleProperty(contents: string, key: string, value: string): string {
  const escapedValue = value.replaceAll('\\', '\\\\')
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  const line = `${key}=${escapedValue}`
  if (pattern.test(contents)) {
    return contents.replace(pattern, line)
  }

  return `${contents.trimEnd()}\n${line}\n`
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function walkFiles(directory: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(entryPath)))
    } else {
      output.push(entryPath)
    }
  }

  return output
}

async function removeEmptyParents(startDirectory: string, stopDirectory: string): Promise<void> {
  let current = startDirectory
  const normalizedStop = resolve(stopDirectory)

  while (resolve(current) === normalizedStop || resolve(current).startsWith(`${normalizedStop}${sep}`)) {
    if (resolve(current) === normalizedStop) {
      return
    }

    const entries = await readdir(current)
    if (entries.length > 0) {
      return
    }

    await rmdir(current)
    current = dirname(current)
  }
}

interface NormalizedApplicationIdSegment {
  adjusted: boolean
  normalized?: string
  original: string
  reason?: 'normalized' | 'reserved'
}

function normalizeApplicationIdSegment(value: string): NormalizedApplicationIdSegment {
  let normalized = value
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!normalized) {
    return {
      adjusted: true,
      original: value,
    }
  }

  let adjusted = normalized !== value

  if (!/^[a-z]/.test(normalized)) {
    normalized = `app${normalized}`
    adjusted = true
  }

  if (RESERVED_PACKAGE_SEGMENTS.has(normalized)) {
    return {
      adjusted: true,
      normalized: `_${normalized}`,
      original: value,
      reason: 'reserved',
    }
  }

  return {
    adjusted,
    normalized,
    original: value,
    reason: adjusted ? 'normalized' : undefined,
  }
}
