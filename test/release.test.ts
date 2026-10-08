import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createApp } from '../src/app.ts'
import type { CommandRunner } from '../src/core/data-access/command-types.ts'
import {
  compareBuildToolsVersionsDescending,
  findApkTools,
  inspectApk,
  isDebugCertificate,
  parseApkBadging,
  parseApkSigners,
} from '../src/release/data-access/inspect-apk.ts'
import { parseAndroidGradle } from '../src/release/data-access/read-android-gradle.ts'
import { findInstalledExpoCli, readExpoProject } from '../src/release/data-access/read-expo-project.ts'
import type {
  ApkInspection,
  ReleaseCheckCommandOptions,
  ReleaseReport,
} from '../src/release/data-access/release-types.ts'
import { type RunReleaseCheckDependencies, runReleaseCheck } from '../src/release/release-feature-check.ts'
import { formatReleaseReport } from '../src/release/ui/release-ui-report.ts'

const expoPackageJson = { dependencies: { expo: '~54.0.0' }, name: 'my-app' }

const releaseAppJson = {
  expo: {
    android: {
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png' },
      package: 'com.example.app',
      versionCode: 3,
    },
    icon: './assets/icon.png',
    name: 'My App',
    version: '1.2.0',
  },
}

/** The app module expo prebuild generates, trimmed to the parts the checks read. */
const prebuildGradle = `
android {
    namespace 'com.example.app'
    defaultConfig {
        applicationId 'com.example.app'
        minSdkVersion rootProject.ext.minSdkVersion
        versionCode 3
        versionName "1.2.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`

/** The prebuild output of a project whose config plugin gives release builds their own signing config. */
const releaseSignedGradle = prebuildGradle.replace(
  /(release \{[\s\S]*?)signingConfigs\.debug/,
  '$1signingConfigs.release',
)

/** Succeeds for every command, which is how `git check-ignore` reports an ignored path. */
function ignoredRunner(calls: string[][] = []): CommandRunner {
  return async (cmd) => {
    calls.push([...cmd])
    return ''
  }
}

/** Runs `run` against a project that passes every check, like `writeReleaseProject`. */
async function withReleaseProject<T>(appJson: object | undefined, run: (root: string) => Promise<T>): Promise<T> {
  let result: T | undefined
  await withTempDir(async (root) => {
    await writeReleaseProject(root, appJson)
    result = await run(root)
  })

  return result as T
}

async function withTempDir(run: (directory: string) => Promise<void>) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'release-test-'))

  try {
    await run(tempDirectory)
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

async function writeProjectFiles(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(
      join(root, path),
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
      'utf8',
    )
  }
}

/** A project that passes every check: static config, both icons on disk, no android/ directory. */
async function writeReleaseProject(root: string, appJson: object = releaseAppJson) {
  await writeProjectFiles(root, {
    'app.json': appJson,
    'assets/adaptive-icon.png': '',
    'assets/icon.png': '',
    'package.json': expoPackageJson,
  })
}

/** Fails every command, which is how `git check-ignore` reports a path that is not ignored. */
const notIgnoredRunner: CommandRunner = async () => {
  throw new Error('exit 1')
}

async function check(
  options: ReleaseCheckCommandOptions,
  dependencies: RunReleaseCheckDependencies = {},
): Promise<{ errors: string; exitCode: number; output: string; report?: ReleaseReport }> {
  let errors = ''
  let output = ''
  const exitCode = await runReleaseCheck(
    { json: true, ...options },
    {
      color: false,
      findExpoCli: async () => undefined,
      runCommand: notIgnoredRunner,
      writeError: (text) => {
        errors += text
      },
      writeOutput: (text) => {
        output += text
      },
      ...dependencies,
    },
  )

  return { errors, exitCode, output, report: output && options.json !== false ? JSON.parse(output) : undefined }
}

function statuses(report: ReleaseReport | undefined) {
  return Object.fromEntries(report?.checks.map(({ name, status }) => [name, status]) ?? [])
}

describe('parseAndroidGradle', () => {
  test('reads the values of the app module expo prebuild generates', () => {
    expect(parseAndroidGradle(prebuildGradle)).toEqual({
      applicationId: 'com.example.app',
      releaseSigning: 'debug',
      versionCode: 3,
      versionName: '1.2.0',
    })
  })

  test('reads a Kotlin DSL app module with its own release signing config', () => {
    const source = `
android {
    defaultConfig {
        applicationId = "com.example.app"
        versionCode = 12
        versionName = "2.0.0"
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("upload")
        }
    }
}
`
    expect(parseAndroidGradle(source)).toEqual({
      applicationId: 'com.example.app',
      releaseSigning: 'custom',
      versionCode: 12,
      versionName: '2.0.0',
    })
  })

  test('leaves computed values undefined', () => {
    const source = `
android {
    defaultConfig {
        applicationId appId
        versionCode rootProject.ext.versionCode
        versionName computeVersionName()
    }
}
`
    expect(parseAndroidGradle(source)).toEqual({
      applicationId: undefined,
      releaseSigning: 'unsigned',
      versionCode: undefined,
      versionName: undefined,
    })
  })

  test.each([
    ['an interpolated Groovy string', `applicationId "com.example.\${flavor}"\n        versionName "\${appVersion}"`],
    ['an interpolated Kotlin string', 'applicationId = "com.example.$flavor"\n        versionName = "$appVersion"'],
    ['a trailing expression', 'applicationId "com.example" + suffix\n        versionName "1.0" + buildSuffix'],
  ])('leaves %s undefined', (_label, values) => {
    const config = parseAndroidGradle(`android {\n    defaultConfig {\n        ${values}\n    }\n}\n`)

    expect(config.applicationId).toBeUndefined()
    expect(config.versionName).toBeUndefined()
  })

  test('reads a single-quoted Groovy string with a dollar sign literally', () => {
    expect(parseAndroidGradle("android { defaultConfig {\n versionName '1.0$'\n} }").versionName).toBe('1.0$')
  })

  test('does not read a suffix property as the value it extends', () => {
    const source = `
android {
    defaultConfig {
        applicationIdSuffix ".beta"
        versionNameSuffix "-beta"
        applicationId "com.example.app"
        versionName "1.2.0"
    }
}
`
    expect(parseAndroidGradle(source)).toMatchObject({ applicationId: 'com.example.app', versionName: '1.2.0' })
  })

  test('reports a signing config looked up by a computed name', () => {
    const source = 'android { buildTypes { release { signingConfig = signingConfigs.getByName(signingKey) } } }'
    expect(parseAndroidGradle(source).releaseSigning).toBe('unknown')
  })

  test('ignores a debug signing config that is commented out', () => {
    const source = `
android {
    buildTypes {
        release {
            // signingConfig signingConfigs.debug
            /* signingConfig signingConfigs.debug */
        }
    }
}
`
    expect(parseAndroidGradle(source).releaseSigning).toBe('unsigned')
  })

  test('reads a Kotlin DSL release build type configured with named()', () => {
    const source = `
android {
    buildTypes {
        named("release") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
`
    expect(parseAndroidGradle(source).releaseSigning).toBe('debug')
  })

  test('does not mistake another build type for release', () => {
    const source = 'android { buildTypes { releaseStaging { signingConfig signingConfigs.debug } } }'
    expect(parseAndroidGradle(source).releaseSigning).toBe('unsigned')
  })

  test('reports a release signing config it cannot resolve', () => {
    const source = 'android { buildTypes { release { signingConfig findSigningConfig() } } }'
    expect(parseAndroidGradle(source).releaseSigning).toBe('unknown')
  })
})

/** `aapt2 dump badging` output of a release build, trimmed to the lines the parser reads. */
const releaseBadging = `package: name='com.example.app' versionCode='3' versionName='1.2.0' platformBuildVersionName='16' compileSdkVersion='36'
sdkVersion:'24'
targetSdkVersion:'36'
application-label:'My App'
`

/** `apksigner verify --print-certs` output for an APK signed with one release key. */
const releaseSigners = `Signer #1 certificate DN: CN=Example, O=Example Inc., C=US
Signer #1 certificate SHA-256 digest: 563d73d9d4bb06941c90a4f6e2b8657f0602c55c6cda904a681f355091823c10
Signer #1 certificate SHA-1 digest: ead52a452ae28fe7544fdbed95f4b35df23c19a2
`

function apkInspection(overrides: Partial<ApkInspection> = {}): ApkInspection {
  return {
    badging: { debuggable: false, packageName: 'com.example.app', versionCode: 3, versionName: '1.2.0' },
    exists: true,
    missingTools: [],
    path: '/builds/app-release.apk',
    signers: [{ dn: 'CN=Example, O=Example Inc., C=US', sha256: '563d73d9' }],
    ...overrides,
  }
}

describe('APK inspection', () => {
  test('parses the manifest values of aapt2 dump badging', () => {
    expect(parseApkBadging(releaseBadging)).toEqual({
      debuggable: false,
      packageName: 'com.example.app',
      versionCode: 3,
      versionName: '1.2.0',
    })
    expect(parseApkBadging(`${releaseBadging}application-debuggable\n`).debuggable).toBe(true)
  })

  test('parses every signer of apksigner verify --print-certs', () => {
    const output = `${releaseSigners}Signer #2 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #2 certificate SHA-256 digest: abc123\n`

    expect(parseApkSigners(output)).toEqual([
      {
        dn: 'CN=Example, O=Example Inc., C=US',
        sha256: '563d73d9d4bb06941c90a4f6e2b8657f0602c55c6cda904a681f355091823c10',
      },
      { dn: 'CN=Android Debug, O=Android, C=US', sha256: 'abc123' },
    ])
  })

  test('parses the per-scheme signers of apksigner from Build-Tools 35 and later', () => {
    const output = `V2 Signer: certificate DN: CN=Android Debug, O=Android, C=US
V2 Signer: certificate SHA-256 digest: 40a294243c1ba8b20babbb3ed724c2fabb998b3e18bfa9737e82ed5b8364c43c
V2 Signer: certificate SHA-1 digest: 5e1c6a8f
V3.0 Signer: certificate DN: CN=Android Debug, O=Android, C=US
V3.0 Signer: certificate SHA-256 digest: 40a294243c1ba8b20babbb3ed724c2fabb998b3e18bfa9737e82ed5b8364c43c
`
    const signers = parseApkSigners(output)

    expect(signers).toEqual([
      {
        dn: 'CN=Android Debug, O=Android, C=US',
        sha256: '40a294243c1ba8b20babbb3ed724c2fabb998b3e18bfa9737e82ed5b8364c43c',
      },
    ])
    expect(signers.some(isDebugCertificate)).toBe(true)
  })

  test('parses the SDK-targeted signers of a v3.1 signature', () => {
    const output = `Signer (minSdkVersion=33, maxSdkVersion=2147483647) certificate DN: CN=Android Debug, O=Android, C=US
Signer (minSdkVersion=33, maxSdkVersion=2147483647) certificate SHA-256 digest: abc123
`
    const signers = parseApkSigners(output)

    expect(signers).toEqual([{ dn: 'CN=Android Debug, O=Android, C=US', sha256: 'abc123' }])
    expect(signers.some(isDebugCertificate)).toBe(true)
  })

  test('parses a v3.1 development-release signer next to a release V2 signer', () => {
    const output = `V2 Signer: certificate DN: CN=Release, O=Example, C=US
V2 Signer: certificate SHA-256 digest: release123
Signer (minSdkVersion=33 (dev release=true), maxSdkVersion=2147483647) certificate DN: CN=Android Debug, O=Android, C=US
Signer (minSdkVersion=33 (dev release=true), maxSdkVersion=2147483647) certificate SHA-256 digest: debug123
`
    const signers = parseApkSigners(output)

    expect(signers).toEqual([
      { dn: 'CN=Release, O=Example, C=US', sha256: 'release123' },
      { dn: 'CN=Android Debug, O=Android, C=US', sha256: 'debug123' },
    ])
    expect(signers.some(isDebugCertificate)).toBe(true)
  })

  test('ignores the source stamp signer', () => {
    expect(parseApkSigners('Source Stamp Signer certificate DN: CN=Android, O=Google Inc.\n')).toEqual([])
  })

  test.each([
    ['CN=Android Debug, O=Android, C=US', true],
    ['CN=Android Debug,O=Android,C=US', true],
    ['CN=Android Debugger Inc., O=Example', false],
    ['CN=Example, O=Android Debug', false],
  ])('recognizes the debug certificate in %p', (dn, expected) => {
    expect(isDebugCertificate({ dn })).toBe(expected)
  })

  test('prefers the newest Build-Tools under ANDROID_HOME and aapt2 over aapt', async () => {
    const buildTools = join('/sdk', 'build-tools')
    const available = new Set([
      join(buildTools, '34.0.0', 'aapt2'),
      join(buildTools, '35.0.1', 'aapt'),
      join(buildTools, '35.0.1', 'aapt2'),
      join(buildTools, '35.0.1', 'apksigner'),
      join('/usr/bin', 'apksigner'),
    ])
    const tools = await findApkTools({
      environment: { ANDROID_HOME: '/sdk', PATH: '/usr/bin' },
      pathExists: async (path) => available.has(path),
      platform: 'linux',
      readDirectory: async (path) => (path === buildTools ? ['34.0.0', '35.0.1', 'debian'] : []),
    })

    expect(tools).toEqual({
      aapt: join(buildTools, '35.0.1', 'aapt2'),
      apksigner: join(buildTools, '35.0.1', 'apksigner'),
    })
  })

  test('uses preview Build-Tools when no release is installed', async () => {
    const buildTools = join('/sdk', 'build-tools')
    const preview = join(buildTools, '36.0.0-rc3')
    const available = new Set([join(preview, 'aapt2'), join(preview, 'apksigner')])
    const tools = await findApkTools({
      environment: { ANDROID_HOME: '/sdk', PATH: '/nowhere' },
      pathExists: async (path) => available.has(path),
      platform: 'linux',
      readDirectory: async (path) => (path === buildTools ? ['36.0.0-rc1', '36.0.0-rc3'] : []),
    })

    expect(tools).toEqual({ aapt: join(preview, 'aapt2'), apksigner: join(preview, 'apksigner') })
  })

  test('orders a final Build-Tools release before its previews', () => {
    expect(
      ['35.0.0', '36.0.0-rc1', '36.0.0', '36.0.0-rc10', '9.0.0'].sort(compareBuildToolsVersionsDescending),
    ).toEqual(['36.0.0', '36.0.0-rc10', '36.0.0-rc1', '35.0.0', '9.0.0'])
  })

  test('falls back to aapt and apksigner on PATH', async () => {
    const available = new Set([join('/usr/bin', 'aapt'), join('/usr/bin', 'apksigner')])
    const tools = await findApkTools({
      environment: { PATH: '/usr/bin' },
      pathExists: async (path) => available.has(path),
      platform: 'linux',
      readDirectory: async () => [],
    })

    expect(tools).toEqual({ aapt: join('/usr/bin', 'aapt'), apksigner: join('/usr/bin', 'apksigner') })
  })

  test('reports the tools it cannot find instead of throwing', async () => {
    const inspection = await inspectApk('/builds/app.apk', {
      environment: { PATH: '/nowhere' },
      pathExists: async (path) => path === '/builds/app.apk',
      platform: 'linux',
      readDirectory: async () => [],
    })

    expect(inspection).toEqual({ exists: true, missingTools: ['aapt2', 'apksigner'], path: '/builds/app.apk' })
  })

  test('reads the APK with the tools it found', async () => {
    const calls: string[][] = []
    const available = new Set(['/builds/app.apk', join('/usr/bin', 'aapt2'), join('/usr/bin', 'apksigner')])
    const inspection = await inspectApk('/builds/app.apk', {
      environment: { PATH: '/usr/bin' },
      pathExists: async (path) => available.has(path),
      platform: 'linux',
      readDirectory: async () => [],
      runCommand: async (cmd) => {
        calls.push([...cmd])
        return cmd[1] === 'dump' ? releaseBadging : releaseSigners
      },
    })

    expect(calls).toEqual([
      [join('/usr/bin', 'aapt2'), 'dump', 'badging', '/builds/app.apk'],
      [join('/usr/bin', 'apksigner'), 'verify', '--print-certs', '/builds/app.apk'],
    ])
    expect(inspection.badging?.versionCode).toBe(3)
    expect(inspection.signers?.[0]?.dn).toBe('CN=Example, O=Example Inc., C=US')
  })

  test('keeps the reason apksigner gives for a signature that does not verify', async () => {
    const available = new Set(['/builds/app.apk', join('/usr/bin', 'aapt2'), join('/usr/bin', 'apksigner')])
    const inspection = await inspectApk('/builds/app.apk', {
      environment: { PATH: '/usr/bin' },
      pathExists: async (path) => available.has(path),
      platform: 'linux',
      readDirectory: async () => [],
      runCommand: async (cmd) => {
        if (cmd[1] === 'dump') return releaseBadging
        throw new Error(
          'Picked up JAVA_TOOL_OPTIONS: -Dfoo=bar\nDOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF\n\tat com.android.apksig.ApkVerifier.verify(ApkVerifier.java:176)',
        )
      },
    })

    expect(inspection.signatureError).toBe('DOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF')
  })

  test('reports an APK that does not exist without running any tool', async () => {
    const inspection = await inspectApk('/builds/missing.apk', {
      pathExists: async () => false,
      runCommand: async () => {
        throw new Error('should not run')
      },
    })

    expect(inspection).toEqual({ exists: false, missingTools: [], path: '/builds/missing.apk' })
  })
})

describe('readExpoProject', () => {
  test('rejects a directory without package.json', async () => {
    await withTempDir(async (root) => {
      await expect(readExpoProject(root, { findExpoCli: async () => undefined })).rejects.toThrow(
        'No package.json found',
      )
    })
  })

  test('rejects a project that does not depend on expo', async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, { 'package.json': { dependencies: { react: '19.0.0' } } })
      await expect(readExpoProject(root, { findExpoCli: async () => undefined })).rejects.toThrow(
        'is not an Expo project',
      )
    })
  })

  test('reads the expo key of app.json when the Expo CLI is not installed', async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, { 'app.json': releaseAppJson, 'package.json': expoPackageJson })
      const project = await readExpoProject(root, { findExpoCli: async () => undefined })

      expect(project).toEqual({ config: releaseAppJson.expo, configSource: 'app.json', root })
    })
  })

  test('refuses to guess a dynamic config without the Expo CLI', async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, {
        'app.config.ts': 'export default {}',
        'app.json': releaseAppJson,
        'package.json': expoPackageJson,
      })

      await expect(readExpoProject(root, { findExpoCli: async () => undefined })).rejects.toThrow(
        "app.config.ts can only be evaluated by the project's Expo CLI",
      )
    })
  })

  test("resolves the config with the project's Expo CLI when it is installed", async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, { 'app.config.ts': 'export default {}', 'package.json': expoPackageJson })
      const calls: string[][] = []
      const project = await readExpoProject(root, {
        findExpoCli: async () => '/repo/node_modules/expo/bin/cli',
        runCommand: async (cmd) => {
          calls.push([...cmd])
          return JSON.stringify(releaseAppJson.expo)
        },
      })

      expect(calls).toEqual([['node', '/repo/node_modules/expo/bin/cli', 'config', root, '--json', '--type', 'public']])
      expect(project).toEqual({ config: releaseAppJson.expo, configSource: 'expo config', root })
    })
  })

  test('finds an Expo CLI hoisted to a monorepo root', async () => {
    await withTempDir(async (directory) => {
      await writeProjectFiles(directory, { 'node_modules/expo/bin/cli': '' })
      const app = join(directory, 'apps', 'mobile')
      await mkdir(app, { recursive: true })

      expect(await findInstalledExpoCli(app)).toBe(join(directory, 'node_modules', 'expo', 'bin', 'cli'))
    })
  })
})

describe('runReleaseCheck', () => {
  test('passes a project that is ready for release', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      const { exitCode, report } = await check({ directory: root })

      expect(exitCode).toBe(0)
      expect(report?.ready).toBe(true)
      expect(report?.project).toEqual({ android: 'missing', configSource: 'app.json', framework: 'expo', root })
      expect(statuses(report)).toEqual({
        'Android package': 'pass',
        'App config': 'warn',
        'App icon': 'pass',
        'App name': 'pass',
        'Native project': 'info',
        'Release signing': 'warn',
        'Version code': 'pass',
        'Version name': 'pass',
      })
    })
  })

  test('checks the current directory when no directory is given', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      const cwd = process.cwd()
      process.chdir(root)

      try {
        const { report } = await check({})
        expect(report?.ready).toBe(true)
      } finally {
        process.chdir(cwd)
      }
    })
  })

  test('fails a missing versionCode, version and package', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root, { expo: { icon: './assets/icon.png', name: 'My App' } })
      const { exitCode, report } = await check({ directory: root })

      expect(exitCode).toBe(1)
      expect(report?.ready).toBe(false)
      expect(statuses(report)).toMatchObject({
        'Android package': 'fail',
        'Version code': 'fail',
        'Version name': 'fail',
      })
    })
  })

  test.each([
    [0, 'fail'],
    [1.5, 'fail'],
    ['3', 'fail'],
    [2_100_000_001, 'fail'],
    [2_100_000_000, 'pass'],
  ] as const)('checks versionCode %p', async (versionCode, status) => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root, {
        expo: { ...releaseAppJson.expo, android: { ...releaseAppJson.expo.android, versionCode } },
      })
      const { report } = await check({ directory: root })

      expect(statuses(report)['Version code']).toBe(status)
    })
  })

  test('fails the placeholder package expo prebuild generates', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root, {
        expo: { ...releaseAppJson.expo, android: { ...releaseAppJson.expo.android, package: 'com.anonymous.myapp' } },
      })
      const { report } = await check({ directory: root })

      expect(statuses(report)['Android package']).toBe('fail')
    })
  })

  test('fails an icon that does not exist', async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, { 'app.json': releaseAppJson, 'package.json': expoPackageJson })
      const { report } = await check({ directory: root })

      expect(report?.checks.find(({ name }) => name === 'App icon')).toMatchObject({
        actual: './assets/adaptive-icon.png, ./assets/icon.png not found',
        status: 'fail',
      })
    })
  })

  test('fails a native android/ that signs release builds with the debug key', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      await writeProjectFiles(root, { 'android/app/build.gradle': prebuildGradle })
      const { exitCode, report } = await check({ directory: root })

      expect(exitCode).toBe(1)
      expect(report?.project.android).toBe('native')
      expect(report?.checks.find(({ name }) => name === 'Native project')?.actual).toBe(
        'android/ is not ignored by git; Gradle builds from it, not from the app config',
      )
      expect(statuses(report)).toMatchObject({
        'Native package': 'pass',
        'Native version code': 'pass',
        'Native version name': 'pass',
        'Release signing': 'fail',
      })
    })
  })

  test('fails a native android/ whose versionCode drifted from the app config', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      await writeProjectFiles(root, {
        'android/app/build.gradle': releaseSignedGradle.replace('versionCode 3', 'versionCode 2'),
      })
      const { report } = await check({ directory: root })

      expect(report?.checks.find(({ name }) => name === 'Native version code')).toMatchObject({
        actual: 'build.gradle has 2, the app config has 3',
        status: 'fail',
      })
      expect(statuses(report)['Release signing']).toBe('pass')
    })
  })

  test('reads the signing config of an android/ directory ignored by git', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      await writeProjectFiles(root, { 'android/app/build.gradle': releaseSignedGradle })
      const calls: string[][] = []
      const { exitCode, report } = await check({ directory: root }, { runCommand: ignoredRunner(calls) })

      expect(calls).toEqual([['git', '-C', root, 'check-ignore', '--quiet', 'android']])
      expect(exitCode).toBe(0)
      expect(report?.project.android).toBe('generated')
      expect(report?.checks.find(({ name }) => name === 'Release signing')).toMatchObject({
        actual: 'release build type has its own signing config (from the last expo prebuild)',
        status: 'pass',
      })
    })
  })

  test('fails a generated android/ that signs release builds with the debug key', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      await writeProjectFiles(root, { 'android/app/build.gradle': prebuildGradle })
      const { exitCode, report } = await check({ directory: root }, { runCommand: ignoredRunner() })

      expect(exitCode).toBe(1)
      expect(report?.checks.find(({ name }) => name === 'Release signing')).toMatchObject({
        recommendation: expect.stringContaining('config plugin'),
        status: 'fail',
      })
    })
  })

  test('warns about a generated android/ that is stale', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      await writeProjectFiles(root, {
        'android/app/build.gradle': releaseSignedGradle.replace('versionCode 3', 'versionCode 2'),
      })
      const { exitCode, report } = await check({ directory: root }, { runCommand: ignoredRunner() })

      expect(exitCode).toBe(0)
      expect(report?.checks.find(({ name }) => name === 'Native version code')).toMatchObject({
        recommendation: 'Run expo prebuild --clean to regenerate android/ from the app config.',
        status: 'warn',
      })
    })
  })

  test('explains the default template signing when android/ was never generated', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      const { report } = await check({ directory: root })

      expect(report?.checks.find(({ name }) => name === 'Release signing')).toMatchObject({
        actual: 'not generated yet; the default prebuild template signs release builds with the debug key',
        status: 'warn',
      })
    })
  })

  test('reports a directory that is not an Expo project', async () => {
    await withTempDir(async (root) => {
      await writeProjectFiles(root, { 'package.json': { name: 'not-expo' } })
      const { errors, exitCode, output } = await check({ directory: root })

      expect(exitCode).toBe(1)
      expect(output).toBe('')
      expect(errors).toContain('is not an Expo project')
    })
  })

  test('prints a readable report', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root, { expo: { ...releaseAppJson.expo, version: undefined } })
      const { output } = await check({ directory: root, json: false })

      expect(output).toContain('Solana Mobile Release Check')
      expect(output).toContain(`Expo project at ${root}`)
      expect(output).toContain('✗ Version name')
      expect(output).toContain('Set expo.version to the version users see')
      expect(output).toContain('Every dApp Store release needs a higher versionCode')
      expect(output).toContain('✗ Set expo.version to the version users see')
      expect(output).toContain('! Sign release builds with your own key')
      expect(output).toContain('Not ready for a dApp Store release: 1 check failed.')
    })
  })

  test('does not give the green verdict to a report with warnings', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      const { exitCode, output } = await check({ directory: root, json: false })

      expect(exitCode).toBe(0)
      expect(output).toContain('! No checks failed, but 2 warnings need a look before submitting to the dApp Store.')
      expect(output).not.toContain('Ready to build a dApp Store release.')
    })
  })

  test('lists each icon once', async () => {
    await withTempDir(async (root) => {
      await writeReleaseProject(root)
      const { output } = await check({ directory: root, json: false, verbose: true })

      expect(output.match(/adaptive-icon\.png/g)).toHaveLength(1)
    })
  })

  describe('with --apk', () => {
    async function checkApk(inspection: ApkInspection, appJson?: object) {
      let inspected: string | undefined
      const result = await withReleaseProject(appJson, (root) =>
        check(
          { apk: 'app-release.apk', directory: root },
          {
            inspectApk: async (path) => {
              inspected = path
              return { ...inspection, path }
            },
          },
        ),
      )

      return { ...result, inspected }
    }

    test('checks the APK instead of guessing the signing config', async () => {
      const { exitCode, inspected, report } = await checkApk(apkInspection())

      expect(inspected).toBe(join(process.cwd(), 'app-release.apk'))
      expect(exitCode).toBe(0)
      expect(report?.project.apk).toBe(inspected)
      expect(statuses(report)).toMatchObject({
        APK: 'info',
        'APK package': 'pass',
        'APK signature': 'pass',
        'APK version code': 'pass',
        'APK version name': 'pass',
      })
      expect(statuses(report)['Release signing']).toBeUndefined()
      expect(report?.checks.find(({ name }) => name === 'APK signature')?.actual).toBe(
        'signed by CN=Example, O=Example Inc., C=US',
      )
    })

    test('fails an APK signed with the debug certificate', async () => {
      const { exitCode, report } = await checkApk(
        apkInspection({ signers: [{ dn: 'C=US, O=Android, CN=Android Debug', sha256: 'abc' }] }),
      )

      expect(exitCode).toBe(1)
      expect(report?.checks.find(({ name }) => name === 'APK signature')).toMatchObject({
        actual: 'signed with the Android debug certificate',
        status: 'fail',
      })
    })

    test('fails an APK whose signature does not verify', async () => {
      const { report } = await checkApk(apkInspection({ signatureError: 'DOES NOT VERIFY', signers: undefined }))

      expect(report?.checks.find(({ name }) => name === 'APK signature')).toMatchObject({
        details: ['DOES NOT VERIFY'],
        status: 'fail',
      })
    })

    test('does not call a verified APK unsigned when its signer cannot be read', async () => {
      const { exitCode, report } = await checkApk(apkInspection({ signers: [] }))

      expect(exitCode).toBe(0)
      expect(report?.checks.find(({ name }) => name === 'APK signature')).toMatchObject({
        actual: 'apksigner verified the APK, but its signer could not be read',
        status: 'warn',
      })
    })

    test('reports a file that is not an APK in one row', async () => {
      const { report } = await checkApk(
        apkInspection({
          badging: undefined,
          badgingError: 'ERROR: dump failed',
          signatureError: 'ERROR: not a ZIP archive',
          signers: undefined,
        }),
      )

      expect(report?.checks.filter(({ name }) => name.startsWith('APK'))).toEqual([
        {
          actual: `${join(process.cwd(), 'app-release.apk')} is not a readable APK`,
          details: ['ERROR: dump failed', 'ERROR: not a ZIP archive'],
          name: 'APK',
          recommendation: 'Pass --apk the path of the release APK Gradle built.',
          status: 'fail',
        },
      ])
    })

    test('fails an APK built from a different versionCode', async () => {
      const { report } = await checkApk(
        apkInspection({
          badging: { debuggable: false, packageName: 'com.example.app', versionCode: 2, versionName: '1.2.0' },
        }),
      )

      expect(report?.checks.find(({ name }) => name === 'APK version code')).toMatchObject({
        actual: 'the APK has 2, the app config has 3',
        status: 'fail',
      })
    })

    test('fails a debuggable APK', async () => {
      const { report } = await checkApk(
        apkInspection({
          badging: { debuggable: true, packageName: 'com.example.app', versionCode: 3, versionName: '1.2.0' },
        }),
      )

      expect(statuses(report)['APK debuggable']).toBe('fail')
    })

    test('fails when the Build-Tools are missing', async () => {
      const { exitCode, report } = await checkApk(
        apkInspection({ badging: undefined, missingTools: ['aapt2', 'apksigner'], signers: undefined }),
      )

      expect(exitCode).toBe(1)
      expect(report?.checks.find(({ name }) => name === 'APK tools')).toMatchObject({
        actual: 'aapt2 and apksigner not found, so the APK could not be fully checked',
        status: 'fail',
      })
      expect(statuses(report)['APK signature']).toBeUndefined()
    })

    test('fails an APK that does not exist', async () => {
      const { report } = await checkApk({ exists: false, missingTools: [], path: '' })

      expect(report?.checks.find(({ name }) => name === 'APK')?.status).toBe('fail')
    })
  })
})

describe('formatReleaseReport', () => {
  test('includes details only when verbose', () => {
    const report: ReleaseReport = {
      checks: [{ actual: 'read from app.json', details: ['a detail'], name: 'App config', status: 'warn' }],
      project: { android: 'missing', configSource: 'app.json', framework: 'expo', root: '/app' },
      ready: true,
      reminders: [],
    }

    expect(formatReleaseReport(report)).not.toContain('a detail')
    expect(formatReleaseReport(report, true)).toContain('a detail')
  })

  test('gives the green verdict only when every check passes', () => {
    const report: ReleaseReport = {
      checks: [{ actual: 'My App', name: 'App name', status: 'pass' }],
      project: { android: 'missing', configSource: 'expo config', framework: 'expo', root: '/app' },
      ready: true,
      reminders: [],
    }

    expect(formatReleaseReport(report)).toContain('✓ Ready to build a dApp Store release.')
  })
})

describe('release command', () => {
  test('passes the directory and flags to the check', async () => {
    const calls: ReleaseCheckCommandOptions[] = []
    const app = createApp({
      checkForNewerVersion: async () => undefined,
      runReleaseCheck: async (options) => {
        calls.push(options)
        return 0
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'release', 'check', 'apps/mobile', '--json'])

    expect(calls).toEqual([{ directory: 'apps/mobile', json: true }])
  })

  test('passes --apk to the check', async () => {
    const calls: ReleaseCheckCommandOptions[] = []
    const app = createApp({
      checkForNewerVersion: async () => undefined,
      runReleaseCheck: async (options) => {
        calls.push(options)
        return 0
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'release', 'check', '--apk', 'build/app-release.apk'])

    expect(calls).toEqual([{ apk: 'build/app-release.apk', directory: undefined }])
  })

  test('sets the exit code from the check', async () => {
    const exitCode = process.exitCode
    const app = createApp({ checkForNewerVersion: async () => undefined, runReleaseCheck: async () => 1 })

    try {
      await app.parseAsync(['node', 'solana-mobile', 'release', 'check'])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = exitCode
    }
  })
})
