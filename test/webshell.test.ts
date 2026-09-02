import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from '../src/app.ts'
import type { CommandRunner, InteractiveRunCommandOptions } from '../src/core/data-access/command-types.ts'
import { runInteractiveExecutable } from '../src/core/data-access/run-executable.ts'
import type { TextPrompt } from '../src/emulator/ui/emulator-ui-prompt-types.ts'
import { applyWebshellBranding } from '../src/webshell/data-access/apply-branding.ts'
import { copyWebshellTemplate } from '../src/webshell/data-access/copy-template.ts'
import { findWebshellTemplateDir } from '../src/webshell/data-access/find-template-dir.ts'
import { ensureKeystore, resolveWebshellSigningPasswords } from '../src/webshell/data-access/keystore.ts'
import {
  readWebshellProjectConfig,
  type WebshellProjectConfig,
  writeWebshellProjectConfig,
} from '../src/webshell/data-access/project-config.ts'
import { readWebshellManifest } from '../src/webshell/data-access/read-manifest.ts'
import {
  renameAndroidPackage,
  validateWebshellApplicationId,
} from '../src/webshell/data-access/rename-android-package.ts'
import type {
  WebshellBuildCommandOptions,
  WebshellInitCommandOptions,
} from '../src/webshell/data-access/webshell-types.ts'
import {
  deriveWebshellApplicationIdSuggestion,
  resolveWebshellCreatePasswords,
} from '../src/webshell/ui/webshell-ui-prompts.ts'
import { type RunWebshellBuildDependencies, runWebshellBuild } from '../src/webshell/webshell-feature-build.ts'
import { type RunWebshellInitDependencies, runWebshellInit } from '../src/webshell/webshell-feature-init.ts'

const webshellFixtures = join(import.meta.dir, 'fixtures', 'webshell')

async function withTempDir(run: (directory: string) => Promise<void>) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'webshell-test-'))

  try {
    await run(tempDirectory)
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

/** Copies the real vendored template into a scratch project directory, then hands it to the test. */
async function withGeneratedProject(run: (projectDirectory: string) => Promise<void>) {
  await withTempDir(async (directory) => {
    const projectDirectory = join(directory, 'generated')
    await copyWebshellTemplate(findWebshellTemplateDir(), projectDirectory)
    await run(projectDirectory)
  })
}

async function walkFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)))
    } else {
      files.push(entryPath)
    }
  }

  return files
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=',
  'base64',
)

/** Records every command so tests can assert on the exact invocations without spawning anything. */
function recordingRunner(): {
  calls: string[][]
  envs: (Record<string, string> | undefined)[]
  runCommand: CommandRunner
} {
  const calls: string[][] = []
  const envs: (Record<string, string> | undefined)[] = []
  const runCommand: CommandRunner = async (cmd, options) => {
    calls.push([...cmd])
    envs.push(options?.env)
    return ''
  }

  return { calls, envs, runCommand }
}

/** Serves a JSON payload for any URL while recording what was requested — tests never hit the network. */
function fakeFetch(payload: unknown): { calls: string[]; fetchFn: (url: URL) => Promise<Response> } {
  const calls: string[] = []
  const fetchFn = async (url: URL) => {
    calls.push(url.toString())
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
  }

  return { calls, fetchFn }
}

describe('findWebshellTemplateDir', () => {
  test('resolves the vendored Android template', () => {
    const dir = findWebshellTemplateDir()
    expect(existsSync(join(dir, 'settings.gradle.kts'))).toBe(true)
    expect(existsSync(join(dir, 'gradle/wrapper/gradle-wrapper.jar'))).toBe(true)
  })
})

describe('readWebshellManifest', () => {
  test('reads a local web manifest.json', async () => {
    const manifest = await readWebshellManifest(join(webshellFixtures, 'manifest.json'))

    expect(manifest.kind).toBe('web')
    expect(manifest.appName).toBe('Example')
    expect(manifest.backgroundColor).toBe('#abcdef')
    expect(manifest.themeColor).toBe('#123456')
    // A relative start_url cannot resolve against a local file, so no web URL is derived.
    expect(manifest.url).toBeUndefined()
    expect(manifest.icons).toEqual([
      {
        purpose: ['any', 'maskable'],
        sizes: [192],
        src: pathToFileURL(join(webshellFixtures, 'icons/icon-192.png')).toString(),
        type: 'image/png',
      },
      {
        purpose: [],
        sizes: [512],
        src: pathToFileURL(join(webshellFixtures, 'icons/icon-512.png')).toString(),
        type: 'image/png',
      },
    ])
  })

  test('maps the fields of a local Bubblewrap twa-manifest.json', async () => {
    const manifest = await readWebshellManifest(join(webshellFixtures, 'twa-manifest.json'))

    expect(manifest.kind).toBe('bubblewrap')
    expect(manifest.appName).toBe('Wallet Shell')
    expect(manifest.applicationId).toBe('com.example.walletshell')
    expect(manifest.keystoreAlias).toBe('release')
    expect(manifest.keystorePath).toBe('./release.keystore')
    expect(manifest.url).toBe('https://app.example.com/launch?mode=prod')
    expect(manifest.versionCode).toBe(12)
    expect(manifest.versionName).toBe('1.2.0')
    expect(manifest.webManifestUrl).toBe('https://app.example.com/manifest.json')
  })

  test('fetches a web manifest from a URL and resolves relative values against it', async () => {
    const { calls, fetchFn } = fakeFetch({
      background_color: '#abcdef',
      icons: [{ sizes: '512x512', src: '/icons/launcher.png', type: 'image/png' }],
      name: 'Trepa',
      start_url: '/app/start',
      theme_color: '#123456',
    })

    const manifest = await readWebshellManifest('https://trepa.app/manifest.json', { fetchFn })

    expect(calls).toEqual(['https://trepa.app/manifest.json'])
    expect(manifest.kind).toBe('web')
    expect(manifest.appName).toBe('Trepa')
    expect(manifest.backgroundColor).toBe('#abcdef')
    expect(manifest.themeColor).toBe('#123456')
    expect(manifest.url).toBe('https://trepa.app/app/start')
    expect(manifest.icons).toEqual([
      { purpose: [], sizes: [512], src: 'https://trepa.app/icons/launcher.png', type: 'image/png' },
    ])
  })

  test('falls back to the site origin and truncates a long name', async () => {
    const { fetchFn } = fakeFetch({ name: 'Jupiter Aggregator' })

    const manifest = await readWebshellManifest('https://jup.ag/manifest.json', { fetchFn })

    expect(manifest.appName).toBe('Jupiter Aggr')
    expect(manifest.url).toBe('https://jup.ag/')
  })

  test('reports a failed manifest download', async () => {
    const fetchFn = async () => new Response('missing', { status: 404, statusText: 'Not Found' })

    await expect(readWebshellManifest('https://trepa.app/manifest.json', { fetchFn })).rejects.toThrow(
      'Failed to fetch https://trepa.app/manifest.json: 404 Not Found',
    )
  })

  test('rejects malformed JSON with the source in the error', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'webshell-manifest-'))

    try {
      const manifestPath = join(tempDirectory, 'manifest.json')
      await writeFile(manifestPath, 'not json {{', 'utf8')

      await expect(readWebshellManifest(manifestPath)).rejects.toThrow(`Failed to parse JSON from ${manifestPath}`)
    } finally {
      await rm(tempDirectory, { force: true, recursive: true })
    }
  })

  test('rejects a manifest that is not a JSON object', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'webshell-manifest-'))

    try {
      const manifestPath = join(tempDirectory, 'manifest.json')
      await writeFile(manifestPath, '["not", "an", "object"]', 'utf8')

      await expect(readWebshellManifest(manifestPath)).rejects.toThrow('Manifest must be a JSON object')
    } finally {
      await rm(tempDirectory, { force: true, recursive: true })
    }
  })
})

describe('webshell project config', () => {
  test('round-trips the config through twa-manifest.json', async () => {
    await withTempDir(async (directory) => {
      await writeWebshellProjectConfig(directory, {
        applicationId: 'com.example.walletshell',
        appName: 'Wallet Shell',
        keystoreAlias: 'release',
        keystorePath: '/tmp/release.keystore',
        url: 'https://app.example.com/launch?mode=prod',
        webManifestUrl: 'https://app.example.com/manifest.json',
      })

      const contents = JSON.parse(await readFile(join(directory, 'twa-manifest.json'), 'utf8'))
      expect(contents.fallbackType).toBe('webview')
      expect(contents.generatorApp).toBe('solana-mobile')
      expect(contents.host).toBe('app.example.com')
      expect(contents.launcherName).toBe('Wallet Shell')
      expect(contents.name).toBe('Wallet Shell')
      expect(contents.packageId).toBe('com.example.walletshell')
      expect(contents.signingKey).toEqual({ alias: 'release', path: '/tmp/release.keystore' })
      expect(contents.startUrl).toBe('/launch?mode=prod')
      expect(contents.webManifestUrl).toBe('https://app.example.com/manifest.json')

      expect(await readWebshellProjectConfig(directory)).toEqual({
        keystoreAlias: 'release',
        keystorePath: '/tmp/release.keystore',
      })
    })
  })

  test('returns undefined when the directory has no twa-manifest.json', async () => {
    await withTempDir(async (directory) => {
      expect(await readWebshellProjectConfig(directory)).toBeUndefined()
    })
  })

  test('never serializes passwords', async () => {
    await withTempDir(async (directory) => {
      await writeWebshellProjectConfig(directory, {
        applicationId: 'com.example.walletshell',
        appName: 'Wallet Shell',
        keyPassword: 'hunter2-key',
        keystoreAlias: 'release',
        keystorePassword: 'hunter2-store',
        keystorePath: '/tmp/release.keystore',
        url: 'https://app.example.com/',
      } as WebshellProjectConfig)

      const raw = await readFile(join(directory, 'twa-manifest.json'), 'utf8')
      expect(raw).not.toContain('hunter2')
      expect(raw.toLowerCase()).not.toContain('password')
    })
  })

  test('keeps unknown fields of an existing Bubblewrap-authored file across a rewrite', async () => {
    await withTempDir(async (directory) => {
      await writeFile(
        join(directory, 'twa-manifest.json'),
        JSON.stringify({
          display: 'standalone',
          enableNotifications: true,
          generatorApp: 'bubblewrap-cli',
          host: 'old.example.com',
          orientation: 'portrait',
          packageId: 'com.example.old',
          shortcuts: [{ name: 'Send', url: '/send' }],
          signingKey: { alias: 'android', path: './android.keystore' },
          themeColor: '#9945ff',
        }),
        'utf8',
      )

      await writeWebshellProjectConfig(directory, {
        applicationId: 'com.example.walletshell',
        appName: 'Wallet Shell',
        url: 'https://app.example.com/launch',
      })

      const contents = JSON.parse(await readFile(join(directory, 'twa-manifest.json'), 'utf8'))
      // Fields this CLI owns are overwritten.
      expect(contents.generatorApp).toBe('solana-mobile')
      expect(contents.host).toBe('app.example.com')
      expect(contents.packageId).toBe('com.example.walletshell')
      // Bubblewrap fields this CLI does not understand survive, keeping the file interoperable.
      expect(contents.display).toBe('standalone')
      expect(contents.enableNotifications).toBe(true)
      expect(contents.orientation).toBe('portrait')
      expect(contents.shortcuts).toEqual([{ name: 'Send', url: '/send' }])
      expect(contents.signingKey).toEqual({ alias: 'android', path: './android.keystore' })
      expect(contents.themeColor).toBe('#9945ff')
    })
  })
})

describe('copyWebshellTemplate', () => {
  test('copies the template with corrected gitignore files and an executable gradlew', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      expect(existsSync(join(projectDirectory, 'settings.gradle.kts'))).toBe(true)
      expect(existsSync(join(projectDirectory, 'gradle/wrapper/gradle-wrapper.jar'))).toBe(true)

      // The template ships its root ignore file un-dotted (npm strips dotted ones); the output must dot it.
      expect(existsSync(join(projectDirectory, 'gitignore'))).toBe(false)
      expect(await readFile(join(projectDirectory, '.gitignore'), 'utf8')).toContain('local.properties')

      // npm also strips nested .gitignore files from tarballs, so this one is recreated, not copied.
      expect(await readFile(join(projectDirectory, 'app', '.gitignore'), 'utf8')).toBe('/build\n')

      expect((await stat(join(projectDirectory, 'gradlew'))).mode & 0o111).not.toBe(0)
    })
  })

  test('refuses a non-empty target directory without force', async () => {
    await withTempDir(async (directory) => {
      await writeFile(join(directory, 'existing.txt'), 'keep', 'utf8')

      await expect(copyWebshellTemplate(findWebshellTemplateDir(), directory)).rejects.toThrow('is not empty')
      expect(await readFile(join(directory, 'existing.txt'), 'utf8')).toBe('keep')
    })
  })

  test('overwrites an existing project with force', async () => {
    await withTempDir(async (directory) => {
      await writeFile(join(directory, 'settings.gradle.kts'), 'stale contents', 'utf8')

      await copyWebshellTemplate(findWebshellTemplateDir(), directory, { force: true })

      expect(await readFile(join(directory, 'settings.gradle.kts'), 'utf8')).toContain('rootProject.name')
    })
  })
})

describe('renameAndroidPackage', () => {
  const baseOptions = {
    applicationId: 'com.example.myapp',
    appName: 'Wallet & Shell',
    projectName: 'generated',
    url: 'https://app.example.com/launch',
    versionCode: 7,
    versionName: '1.2.3',
  }

  test('configures the project for a new application id', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await renameAndroidPackage(projectDirectory, baseOptions)

      const gradleProperties = await readFile(join(projectDirectory, 'gradle.properties'), 'utf8')
      expect(gradleProperties).toContain('SOLANA_MOBILE_URL=https://app.example.com/launch')
      expect(gradleProperties).toContain('SOLANA_MOBILE_APPLICATION_ID=com.example.myapp')
      expect(gradleProperties).toContain('SOLANA_MOBILE_VERSION_CODE=7')
      expect(gradleProperties).toContain('SOLANA_MOBILE_VERSION_NAME=1.2.3')
      expect(gradleProperties).not.toContain('com.example.webshell')

      const settings = await readFile(join(projectDirectory, 'settings.gradle.kts'), 'utf8')
      expect(settings).toContain('rootProject.name = "generated"')

      const buildScript = await readFile(join(projectDirectory, 'app', 'build.gradle.kts'), 'utf8')
      expect(buildScript).toContain('namespace = "com.example.myapp"')

      const strings = await readFile(join(projectDirectory, 'app/src/main/res/values/strings.xml'), 'utf8')
      expect(strings).toContain('<string name="app_name">Wallet &amp; Shell</string>')

      // The Kotlin tree moved to the new package, and no source file references the template package.
      const mainActivity = await readFile(
        join(projectDirectory, 'app/src/main/java/com/example/myapp/MainActivity.kt'),
        'utf8',
      )
      expect(mainActivity).toMatch(/^package com\.example\.myapp$/m)
      expect(mainActivity).toContain('import com.example.myapp.ui.theme.WebShellTheme')
      expect(existsSync(join(projectDirectory, 'app/src/main/java/com/example/webshell'))).toBe(false)
      for (const file of await walkFiles(join(projectDirectory, 'app/src/main/java'))) {
        expect(await readFile(file, 'utf8')).not.toContain('com.example.webshell')
      }

      const readme = await readFile(join(projectDirectory, 'README.md'), 'utf8')
      expect(readme).toContain('com.example.myapp')
      expect(readme).toContain('solana-mobile webshell build .')

      expect((await stat(join(projectDirectory, 'gradlew'))).mode & 0o111).not.toBe(0)
    })
  })

  test('keeps the application id but sanitizes reserved Kotlin keywords in the package', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await renameAndroidPackage(projectDirectory, { ...baseOptions, applicationId: 'fun.cfl.www' })

      const gradleProperties = await readFile(join(projectDirectory, 'gradle.properties'), 'utf8')
      expect(gradleProperties).toContain('SOLANA_MOBILE_APPLICATION_ID=fun.cfl.www')

      const buildScript = await readFile(join(projectDirectory, 'app', 'build.gradle.kts'), 'utf8')
      expect(buildScript).toContain('namespace = "_fun.cfl.www"')

      expect(existsSync(join(projectDirectory, 'app/src/main/java/_fun/cfl/www/MainActivity.kt'))).toBe(true)
    })
  })

  test('survives an application id that is an ancestor of the template package', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await renameAndroidPackage(projectDirectory, { ...baseOptions, applicationId: 'com.example' })

      expect(existsSync(join(projectDirectory, 'app/src/main/java/com/example/MainActivity.kt'))).toBe(true)
      expect(existsSync(join(projectDirectory, 'app/src/main/java/com/example/webshell'))).toBe(false)
    })
  })

  test('survives an application id equal to the template package', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await renameAndroidPackage(projectDirectory, { ...baseOptions, applicationId: 'com.example.webshell' })

      expect(existsSync(join(projectDirectory, 'app/src/main/java/com/example/webshell/MainActivity.kt'))).toBe(true)
    })
  })

  test('rejects invalid application ids without touching the project', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      for (const invalid of ['com.1example', 'com.example-app', 'Com.Example.App', 'com..example', 'example']) {
        expect(validateWebshellApplicationId(invalid)).toContain('Application ID must look like com.example.app')
        await expect(
          renameAndroidPackage(projectDirectory, { ...baseOptions, applicationId: invalid }),
        ).rejects.toThrow('Application ID must look like com.example.app')
      }

      // A failed rename leaves the template defaults untouched.
      const gradleProperties = await readFile(join(projectDirectory, 'gradle.properties'), 'utf8')
      expect(gradleProperties).toContain('SOLANA_MOBILE_APPLICATION_ID=com.example.webshell')
    })
  })
})

describe('applyWebshellBranding', () => {
  /** Serves the tiny PNG for any URL while recording what was fetched. */
  function fakeIconFetch(): { calls: string[]; fetchFn: (url: URL) => Promise<Response> } {
    const calls: string[] = []
    const fetchFn = async (url: URL) => {
      calls.push(url.toString())
      return new Response(new Uint8Array(tinyPng), { headers: { 'content-type': 'image/png' } })
    }

    return { calls, fetchFn }
  }

  const rejectingFetch = async (): Promise<Response> => {
    throw new Error('unexpected fetch')
  }

  test('downloads the preferred manifest icon and writes the launcher artwork', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      const { calls, fetchFn } = fakeIconFetch()

      await applyWebshellBranding(
        projectDirectory,
        {
          backgroundColor: '#F5F5F5',
          icons: [
            // The larger "any" icon loses to maskable artwork, which survives adaptive-icon cropping.
            { purpose: [], sizes: [1024], src: 'https://app.example.com/icons/any.png', type: 'image/png' },
            {
              purpose: ['maskable'],
              sizes: [512],
              src: 'https://app.example.com/icons/maskable.png',
              type: 'image/png',
            },
          ],
          themeColor: '#123456',
        },
        { fetchFn },
      )

      expect(calls).toEqual(['https://app.example.com/icons/maskable.png'])

      const colors = await readFile(join(projectDirectory, 'app/src/main/res/values/colors.xml'), 'utf8')
      expect(colors).toContain('<color name="launcher_icon_background">#123456</color>')
      expect(colors).toContain('<color name="splash_background">#F5F5F5</color>')

      const foreground = await readFile(
        join(projectDirectory, 'app/src/main/res/drawable/ic_launcher_foreground.xml'),
        'utf8',
      )
      expect(foreground).toContain('android:drawable="@drawable/ic_launcher_foreground_inner"')

      const icon = await readFile(
        join(projectDirectory, 'app/src/main/res/drawable-nodpi/ic_launcher_foreground_inner.png'),
      )
      expect(icon.equals(tinyPng)).toBe(true)
    })
  })

  test('copies a local file icon without fetching', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      const iconPath = join(projectDirectory, 'local-icon.png')
      await writeFile(iconPath, tinyPng)

      await applyWebshellBranding(
        projectDirectory,
        { icons: [{ purpose: [], sizes: [512], src: pathToFileURL(iconPath).toString(), type: 'image/png' }] },
        { fetchFn: rejectingFetch },
      )

      const icon = await readFile(
        join(projectDirectory, 'app/src/main/res/drawable-nodpi/ic_launcher_foreground_inner.png'),
      )
      expect(icon.equals(tinyPng)).toBe(true)
    })
  })

  test('keeps the template launcher artwork when the icon download fails', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      const warnings: string[] = []
      const fetchFn = async () => new Response('missing', { status: 404, statusText: 'Not Found' })

      await applyWebshellBranding(
        projectDirectory,
        {
          backgroundColor: '#FAFAFA',
          icons: [{ purpose: [], sizes: [512], src: 'https://app.example.com/icon.png', type: 'image/png' }],
          themeColor: '#abc',
        },
        { fetchFn, logWarning: (message) => warnings.push(message) },
      )

      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.join('\n')).toContain('https://app.example.com/icon.png')

      // Colors are still applied — a short hex color expands to the Android six-digit form.
      const colors = await readFile(join(projectDirectory, 'app/src/main/res/values/colors.xml'), 'utf8')
      expect(colors).toContain('<color name="launcher_icon_background">#AABBCC</color>')
      expect(colors).toContain('<color name="splash_background">#FAFAFA</color>')

      // The template's default vector foreground stays in place.
      expect(
        existsSync(join(projectDirectory, 'app/src/main/res/drawable-nodpi/ic_launcher_foreground_inner.png')),
      ).toBe(false)
      const foreground = await readFile(
        join(projectDirectory, 'app/src/main/res/drawable/ic_launcher_foreground.xml'),
        'utf8',
      )
      expect(foreground).toContain('<vector xmlns:android=')
    })
  })

  test('keeps the template launcher artwork when no manifest icon is supported', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await applyWebshellBranding(
        projectDirectory,
        {
          icons: [
            { purpose: ['maskable'], sizes: [512], src: 'https://app.example.com/icon.svg', type: 'image/svg+xml' },
          ],
        },
        { fetchFn: rejectingFetch },
      )

      expect(
        existsSync(join(projectDirectory, 'app/src/main/res/drawable-nodpi/ic_launcher_foreground_inner.png')),
      ).toBe(false)
      const foreground = await readFile(
        join(projectDirectory, 'app/src/main/res/drawable/ic_launcher_foreground.xml'),
        'utf8',
      )
      expect(foreground).toContain('<vector xmlns:android=')
    })
  })

  test('moves the alpha channel of CSS hex colors to the front for Android', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await applyWebshellBranding(
        projectDirectory,
        // CSS carries alpha last (#RRGGBBAA, #RGBA); Android colors.xml expects it first (#AARRGGBB).
        { backgroundColor: '#123456ff', themeColor: '#abcd' },
        { fetchFn: rejectingFetch },
      )

      const colors = await readFile(join(projectDirectory, 'app/src/main/res/values/colors.xml'), 'utf8')
      expect(colors).toContain('<color name="splash_background">#FF123456</color>')
      expect(colors).toContain('<color name="launcher_icon_background">#DDAABBCC</color>')
    })
  })

  test('falls back to the default Android green without a manifest', async () => {
    await withGeneratedProject(async (projectDirectory) => {
      await applyWebshellBranding(projectDirectory, undefined, { fetchFn: rejectingFetch })

      const colors = await readFile(join(projectDirectory, 'app/src/main/res/values/colors.xml'), 'utf8')
      expect(colors).toContain('<color name="launcher_icon_background">#3DDC84</color>')
      expect(colors).toContain('<color name="splash_background">#3DDC84</color>')
    })
  })
})

describe('webshell keystore', () => {
  const baseOptions = {
    appName: 'Wallet Shell',
    keyPassword: 'key-secret',
    keystoreAlias: 'release',
    keystorePassword: 'store-secret',
  }

  test('generates a missing keystore via keytool', async () => {
    await withTempDir(async (directory) => {
      const keystorePath = join(directory, 'keys', 'release.keystore')
      const { calls, envs, runCommand } = recordingRunner()

      const created = await ensureKeystore({ ...baseOptions, keystorePath }, { runCommand })

      expect(created).toBe(true)
      expect(calls).toEqual([
        [
          'keytool',
          '-genkeypair',
          '-v',
          '-keystore',
          keystorePath,
          '-alias',
          'release',
          '-keyalg',
          'RSA',
          '-keysize',
          '2048',
          '-validity',
          '10000',
          '-storepass:env',
          'SOLANA_MOBILE_KEYSTORE_PASSWORD',
          '-keypass:env',
          'SOLANA_MOBILE_KEY_PASSWORD',
          '-dname',
          'CN=Wallet Shell, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=US',
          '-noprompt',
        ],
      ])
      // The passwords stay out of argv (visible in process listings) and travel via the child env.
      expect(calls[0]).not.toContain('store-secret')
      expect(calls[0]).not.toContain('key-secret')
      expect(envs).toEqual([
        { SOLANA_MOBILE_KEY_PASSWORD: 'key-secret', SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret' },
      ])
      // The parent directory is created ahead of time so keytool can write the file.
      expect(existsSync(join(directory, 'keys'))).toBe(true)
    })
  })

  test('sanitizes the app name in the certificate distinguished name', async () => {
    await withTempDir(async (directory) => {
      const { calls, runCommand } = recordingRunner()

      await ensureKeystore(
        { ...baseOptions, appName: 'Wallet, "Shell" <Dev>+', keystorePath: join(directory, 'a.keystore') },
        { runCommand },
      )
      await ensureKeystore(
        { ...baseOptions, appName: '  ', keystorePath: join(directory, 'b.keystore') },
        { runCommand },
      )

      const dnames = calls.map((cmd) => cmd[cmd.indexOf('-dname') + 1])
      expect(dnames).toEqual([
        'CN=Wallet Shell Dev, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=US',
        'CN=Solana Mobile Web Shell, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=US',
      ])
    })
  })

  test('skips generation when the keystore already exists', async () => {
    await withTempDir(async (directory) => {
      const keystorePath = join(directory, 'release.keystore')
      await writeFile(keystorePath, 'existing')
      const { calls, runCommand } = recordingRunner()

      const created = await ensureKeystore({ ...baseOptions, keystorePath }, { runCommand })

      expect(created).toBe(false)
      expect(calls).toEqual([])
    })
  })

  test('environment variables short-circuit password prompting', async () => {
    const promptPassword = async (): Promise<string | symbol> => {
      throw new Error('prompt should not be called')
    }

    const passwords = await resolveWebshellSigningPasswords({
      env: { SOLANA_MOBILE_KEY_PASSWORD: 'key-secret', SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret' },
      promptPassword,
    })

    expect(passwords).toEqual({ keyPassword: 'key-secret', keystorePassword: 'store-secret' })
  })

  test('prompts for the keystore password and reuses it for the key', async () => {
    const messages: string[] = []
    const promptPassword = async ({ message }: { message: string }): Promise<string | symbol> => {
      messages.push(message)
      return 'prompted-secret'
    }

    const passwords = await resolveWebshellSigningPasswords({ env: {}, promptPassword })

    expect(messages).toEqual(['Keystore password (SOLANA_MOBILE_KEYSTORE_PASSWORD is not set)'])
    expect(passwords).toEqual({ keyPassword: 'prompted-secret', keystorePassword: 'prompted-secret' })
  })

  test('a dedicated key password from the environment overrides the prompted keystore password', async () => {
    const promptPassword = async (): Promise<string | symbol> => 'prompted-secret'

    const passwords = await resolveWebshellSigningPasswords({
      env: { SOLANA_MOBILE_KEY_PASSWORD: 'key-only' },
      promptPassword,
    })

    expect(passwords).toEqual({ keyPassword: 'key-only', keystorePassword: 'prompted-secret' })
  })

  test('a cancelled password prompt is passed through for the caller to handle', async () => {
    const cancelled = Symbol('clack:cancel')
    const promptPassword = async (): Promise<string | symbol> => cancelled

    expect(await resolveWebshellSigningPasswords({ env: {}, promptPassword })).toBe(cancelled)
  })
})

describe('deriveWebshellApplicationIdSuggestion', () => {
  test('reverses the URL host into an application id', () => {
    expect(deriveWebshellApplicationIdSuggestion('https://app.example.com/launch')).toEqual({
      applicationId: 'com.example.app',
    })
  })

  test('normalizes host segments that are not valid package segments', () => {
    expect(deriveWebshellApplicationIdSuggestion('https://my-app.example.com')).toEqual({
      applicationId: 'com.example.my_app',
      note: 'Adjusted the default application ID to com.example.my_app to keep it Android-safe.',
    })
  })

  test('keeps reserved Kotlin words: they are valid in an application id', () => {
    expect(deriveWebshellApplicationIdSuggestion('https://www.cfl.fun')).toEqual({
      applicationId: 'fun.cfl.www',
    })
  })

  test('gives no suggestion for localhost, raw IPs, short hosts, or junk', () => {
    expect(deriveWebshellApplicationIdSuggestion('http://localhost:3000')).toEqual({})
    expect(deriveWebshellApplicationIdSuggestion('http://192.168.1.10/')).toEqual({})
    expect(deriveWebshellApplicationIdSuggestion('https://example')).toEqual({})
    expect(deriveWebshellApplicationIdSuggestion('not a url')).toEqual({})
  })
})

describe('resolveWebshellCreatePasswords', () => {
  const throwingConfirm = async (): Promise<boolean | symbol> => {
    throw new Error('confirm prompt should not be called')
  }
  const throwingPassword = async (): Promise<string | symbol> => {
    throw new Error('password prompt should not be called')
  }

  test('rejects environment passwords shorter than the keytool minimum', async () => {
    await expect(
      resolveWebshellCreatePasswords({
        env: { SOLANA_MOBILE_KEYSTORE_PASSWORD: 'short' },
        runConfirm: throwingConfirm,
        runPassword: throwingPassword,
      }),
    ).rejects.toThrow('SOLANA_MOBILE_KEYSTORE_PASSWORD must be at least 6 characters.')
  })

  test('environment variables win without prompting', async () => {
    const passwords = await resolveWebshellCreatePasswords({
      env: { SOLANA_MOBILE_KEY_PASSWORD: 'key-secret', SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret' },
      runConfirm: throwingConfirm,
      runPassword: throwingPassword,
    })

    expect(passwords).toEqual({ keyPassword: 'key-secret', keystorePassword: 'store-secret' })
  })

  test('prompts for a confirmed password and reuses it for the key', async () => {
    const confirms: string[] = []
    const messages: string[] = []

    const passwords = await resolveWebshellCreatePasswords({
      env: {},
      runConfirm: async ({ message }) => {
        confirms.push(message)
        return true
      },
      runPassword: async ({ message }) => {
        messages.push(message)
        return 'secret-1'
      },
    })

    expect(passwords).toEqual({ keyPassword: 'secret-1', keystorePassword: 'secret-1' })
    expect(messages).toEqual(['Keystore password', 'Confirm keystore password'])
    expect(confirms).toEqual(['Use the same password for the signing key?'])
  })

  test('re-prompts on a mismatch, then accepts a separate key password', async () => {
    const errors: string[] = []
    const responses = ['store-a', 'store-b', 'store-c', 'store-c', 'key-1', 'key-1']

    const passwords = await resolveWebshellCreatePasswords({
      env: {},
      logError: (message) => {
        errors.push(message)
      },
      runConfirm: async () => false,
      runPassword: async () => responses.shift() ?? Symbol('exhausted'),
    })

    expect(passwords).toEqual({ keyPassword: 'key-1', keystorePassword: 'store-c' })
    expect(errors).toEqual(['Passwords do not match. Try again.'])
  })

  test('a cancelled prompt is passed through for the caller to handle', async () => {
    const cancelled = Symbol('cancelled')

    const passwords = await resolveWebshellCreatePasswords({
      env: {},
      runConfirm: throwingConfirm,
      runPassword: async () => cancelled,
    })

    expect(passwords).toBe(cancelled)
  })
})

describe('runWebshellInit', () => {
  const throwingText: TextPrompt = async () => {
    throw new Error('text prompt should not be called')
  }

  const completeInitOptions = {
    applicationId: 'com.example.smoke',
    appName: 'Smoke',
    directory: '/tmp/webshell-smoke',
    keystoreAlias: 'smoke',
    keystorePath: '/tmp/webshell-smoke/smoke.keystore',
    url: 'https://example.com',
    versionCode: 7,
    versionName: '1.2.3',
  }

  function initDependencies(overrides: RunWebshellInitDependencies = {}) {
    const state = {
      branding: [] as { directory: string; manifest: unknown }[],
      cancelled: undefined as string | undefined,
      configs: [] as { config: WebshellProjectConfig; projectDirectory: string }[],
      copies: [] as { force: boolean | undefined; targetDirectory: string; templateDirectory: string }[],
      keystores: [] as unknown[],
      logs: [] as string[],
      outro: undefined as string | undefined,
      renames: [] as { options: unknown; projectDirectory: string }[],
    }

    const dependencies: RunWebshellInitDependencies = {
      applyBranding: async (directory, manifest) => {
        state.branding.push({ directory, manifest })
      },
      cancel: (message) => {
        state.cancelled = message
      },
      copyTemplate: async (templateDirectory, targetDirectory, copyOptions) => {
        state.copies.push({ force: copyOptions?.force, targetDirectory, templateDirectory })
      },
      createKeystore: async (keystoreOptions) => {
        state.keystores.push(keystoreOptions)
        return true
      },
      fileExists: async () => false,
      findTemplateDir: () => '/fake/template',
      intro: () => {},
      log: (message) => {
        state.logs.push(message)
      },
      outro: (message) => {
        state.outro = message
      },
      renamePackage: async (projectDirectory, renameOptions) => {
        state.renames.push({ options: renameOptions, projectDirectory })
      },
      resolvePasswords: async () => ({ keyPassword: 'key-secret', keystorePassword: 'store-secret' }),
      runText: throwingText,
      warn: (message) => {
        state.logs.push(message)
      },
      writeProjectConfig: async (projectDirectory, config) => {
        state.configs.push({ config, projectDirectory })
      },
      ...overrides,
    }

    return { dependencies, state }
  }

  test('runs the full pipeline without prompting when every option is provided', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = initDependencies()

    await runWebshellInit(completeInitOptions, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(state.copies).toEqual([
      { force: undefined, targetDirectory: '/tmp/webshell-smoke', templateDirectory: '/fake/template' },
    ])
    expect(state.renames).toEqual([
      {
        options: {
          applicationId: 'com.example.smoke',
          appName: 'Smoke',
          keystoreAlias: 'smoke',
          keystorePath: '/tmp/webshell-smoke/smoke.keystore',
          projectName: 'webshell-smoke',
          url: 'https://example.com/',
          versionCode: 7,
          versionName: '1.2.3',
        },
        projectDirectory: '/tmp/webshell-smoke',
      },
    ])
    expect(state.branding).toEqual([{ directory: '/tmp/webshell-smoke', manifest: undefined }])
    expect(state.keystores).toEqual([
      {
        appName: 'Smoke',
        keyPassword: 'key-secret',
        keystoreAlias: 'smoke',
        keystorePassword: 'store-secret',
        keystorePath: '/tmp/webshell-smoke/smoke.keystore',
      },
    ])
    expect(state.configs).toEqual([
      {
        config: {
          applicationId: 'com.example.smoke',
          appName: 'Smoke',
          keystoreAlias: 'smoke',
          keystorePath: 'smoke.keystore',
          url: 'https://example.com/',
          webManifestUrl: undefined,
        },
        projectDirectory: '/tmp/webshell-smoke',
      },
    ])
    expect(state.outro).toContain('webshell build /tmp/webshell-smoke')
    expect(process.exitCode).toBe(previousExitCode)
  })

  test('resolves a relative --keystore-path against the project directory, not the cwd', async () => {
    const { dependencies, state } = initDependencies()

    await runWebshellInit({ ...completeInitOptions, keystorePath: 'release.keystore' }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(state.keystores[0]).toMatchObject({ keystorePath: '/tmp/webshell-smoke/release.keystore' })
    expect(state.configs[0]?.config.keystorePath).toBe('release.keystore')
  })

  test('fills missing values from a manifest without prompting', async () => {
    const { dependencies, state } = initDependencies({
      readManifest: async (source) => ({
        appName: 'Trepa',
        backgroundColor: '#abcdef',
        kind: 'web',
        source,
        themeColor: '#123456',
        url: 'https://trepa.app/start',
        webManifestUrl: 'https://trepa.app/manifest.json',
      }),
    })

    await runWebshellInit(
      {
        applicationId: 'com.example.trepa',
        directory: '/tmp/webshell-trepa',
        keystoreAlias: 'trepa',
        keystorePath: '/tmp/trepa.keystore',
        manifest: 'https://trepa.app/manifest.json',
        versionCode: 1,
        versionName: '1.0',
      },
      dependencies,
    )

    expect(state.cancelled).toBeUndefined()
    expect(state.renames).toEqual([
      {
        options: expect.objectContaining({ appName: 'Trepa', url: 'https://trepa.app/start' }),
        projectDirectory: '/tmp/webshell-trepa',
      },
    ])
    expect(state.branding).toEqual([
      {
        directory: '/tmp/webshell-trepa',
        manifest: expect.objectContaining({ backgroundColor: '#abcdef', themeColor: '#123456' }),
      },
    ])
    expect(state.configs[0]?.config.webManifestUrl).toBe('https://trepa.app/manifest.json')
  })

  test('exits quietly when a prompt is cancelled', async () => {
    const { dependencies, state } = initDependencies({ runText: async () => Symbol('cancelled') })

    await runWebshellInit({ directory: '/tmp/webshell-cancel' }, dependencies)

    expect(state.copies).toEqual([])
    expect(state.configs).toEqual([])
    expect(state.outro).toBeUndefined()
  })

  test('cancels with exit code 1 when password resolution is cancelled', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = initDependencies({ resolvePasswords: async () => Symbol('cancelled') })

    await runWebshellInit(completeInitOptions, dependencies)

    expect(state.cancelled).toBe('Cancelled')
    expect(state.keystores).toEqual([])
    expect(state.configs).toEqual([])
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('rejects an invalid application id before touching anything', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = initDependencies()

    await runWebshellInit({ ...completeInitOptions, applicationId: 'com.example-app' }, dependencies)

    expect(state.cancelled).toContain('Application ID must look like com.example.app')
    expect(state.copies).toEqual([])
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('generates a real project end to end from a fetched manifest', async () => {
    await withTempDir(async (directory) => {
      const projectDirectory = join(directory, 'shell')
      const keystorePath = join(directory, 'keys', 'release.keystore')
      const { calls, envs, runCommand } = recordingRunner()
      const state = { cancelled: undefined as string | undefined, outro: undefined as string | undefined }

      const fetchFn = async (url: URL) => {
        if (url.toString() === 'https://trepa.app/manifest.json') {
          const payload = {
            background_color: '#abcdef',
            icons: [{ purpose: 'maskable', sizes: '512x512', src: '/icons/maskable.png', type: 'image/png' }],
            name: 'Trepa Predictions',
            short_name: 'Trepa',
            start_url: '/',
            theme_color: '#123456',
          }

          return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
        }

        return new Response(new Uint8Array(tinyPng), { headers: { 'content-type': 'image/png' } })
      }

      await runWebshellInit(
        {
          applicationId: 'com.example.trepa',
          directory: projectDirectory,
          keystoreAlias: 'release',
          keystorePath,
          manifest: 'https://trepa.app/manifest.json',
          versionCode: 2,
          versionName: '1.1',
        },
        {
          cancel: (message) => {
            state.cancelled = message
          },
          env: { SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret' },
          fetchFn,
          intro: () => {},
          log: () => {},
          outro: (message) => {
            state.outro = message
          },
          runCommand,
          runText: throwingText,
          warn: () => {},
        },
      )

      expect(state.cancelled).toBeUndefined()

      // The template was copied and configured for the requested identity.
      const gradleProperties = await readFile(join(projectDirectory, 'gradle.properties'), 'utf8')
      expect(gradleProperties).toContain('SOLANA_MOBILE_URL=https://trepa.app/')
      expect(gradleProperties).toContain('SOLANA_MOBILE_APPLICATION_ID=com.example.trepa')
      expect(gradleProperties).toContain('SOLANA_MOBILE_VERSION_CODE=2')
      expect(gradleProperties).toContain('SOLANA_MOBILE_VERSION_NAME=1.1')
      expect(existsSync(join(projectDirectory, 'app/src/main/java/com/example/trepa/MainActivity.kt'))).toBe(true)

      // The app name came from the manifest's short_name.
      const strings = await readFile(join(projectDirectory, 'app/src/main/res/values/strings.xml'), 'utf8')
      expect(strings).toContain('<string name="app_name">Trepa</string>')

      // Branding was applied from the manifest colors and icon.
      const colors = await readFile(join(projectDirectory, 'app/src/main/res/values/colors.xml'), 'utf8')
      expect(colors).toContain('<color name="launcher_icon_background">#123456</color>')
      expect(
        existsSync(join(projectDirectory, 'app/src/main/res/drawable-nodpi/ic_launcher_foreground_inner.png')),
      ).toBe(true)

      // Keystore creation went through keytool with the password in the child env, never in argv.
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[0]).toBe('keytool')
      expect(calls[0]).toContain(keystorePath)
      expect(calls[0]).toContain('release')
      expect(calls[0]).not.toContain('store-secret')
      expect(envs[0]).toEqual({
        SOLANA_MOBILE_KEY_PASSWORD: 'store-secret',
        SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret',
      })

      // The Bubblewrap-compatible project config points back at everything.
      const config = JSON.parse(await readFile(join(projectDirectory, 'twa-manifest.json'), 'utf8'))
      expect(config.generatorApp).toBe('solana-mobile')
      expect(config.packageId).toBe('com.example.trepa')
      expect(config.signingKey).toEqual({ alias: 'release', path: keystorePath })
      expect(config.webManifestUrl).toBe('https://trepa.app/manifest.json')

      expect(state.outro).toContain('webshell build')
    })
  })
})

describe('runWebshellBuild', () => {
  interface InteractiveCall {
    cmd: string[]
    options?: InteractiveRunCommandOptions
  }

  function buildDependencies(overrides: RunWebshellBuildDependencies = {}) {
    const state = {
      calls: [] as InteractiveCall[],
      cancelled: undefined as string | undefined,
      logs: [] as string[],
      outro: undefined as string | undefined,
    }

    const dependencies: RunWebshellBuildDependencies = {
      cancel: (message) => {
        state.cancelled = message
      },
      intro: () => {},
      log: (message) => {
        state.logs.push(message)
      },
      outro: (message) => {
        state.outro = message
      },
      readProjectConfig: async () => ({ keystoreAlias: 'release', keystorePath: './release.keystore' }),
      resolvePasswords: async () => ({ keyPassword: 'key-secret', keystorePassword: 'store-secret' }),
      runInteractiveCommand: async (cmd, runOptions) => {
        state.calls.push({ cmd: [...cmd], options: runOptions })
      },
      ...overrides,
    }

    return { dependencies, state }
  }

  test('runs gradle in the project directory with signing properties and passwords in the child env', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = buildDependencies()

    await runWebshellBuild({ directory: '/tmp/webshell-app' }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(state.calls).toEqual([
      {
        cmd: [
          '/tmp/webshell-app/gradlew',
          'assembleRelease',
          '-PSOLANA_MOBILE_KEYSTORE_PATH=/tmp/webshell-app/release.keystore',
          '-PSOLANA_MOBILE_KEYSTORE_ALIAS=release',
        ],
        options: {
          cwd: '/tmp/webshell-app',
          env: { SOLANA_MOBILE_KEY_PASSWORD: 'key-secret', SOLANA_MOBILE_KEYSTORE_PASSWORD: 'store-secret' },
        },
      },
    ])
    expect(state.outro).toContain('/tmp/webshell-app/app/build/outputs/apk/release/app-release.apk')
    expect(process.exitCode).toBe(previousExitCode)
  })

  test('invokes gradlew.bat through cmd.exe on Windows', async () => {
    const { dependencies, state } = buildDependencies({ platform: 'win32' })

    await runWebshellBuild({ directory: '/tmp/webshell-app' }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(state.calls[0]?.cmd).toEqual([
      'cmd.exe',
      '/c',
      '/tmp/webshell-app/gradlew.bat',
      'assembleRelease',
      '-PSOLANA_MOBILE_KEYSTORE_PATH=/tmp/webshell-app/release.keystore',
      '-PSOLANA_MOBILE_KEYSTORE_ALIAS=release',
    ])
  })

  test('rejects cmd.exe metacharacters in signing values on Windows', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = buildDependencies({ platform: 'win32' })

    await runWebshellBuild({ directory: '/tmp/webshell-app', keystorePath: 'evil&calc.keystore' }, dependencies)

    expect(state.cancelled).toContain('cmd.exe')
    expect(state.calls).toHaveLength(0)
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('errors clearly when the directory is not a webshell project', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = buildDependencies({ readProjectConfig: async () => undefined })

    await runWebshellBuild({ directory: '/tmp/not-a-project' }, dependencies)

    expect(state.cancelled).toContain('is not a webshell project')
    expect(state.cancelled).toContain('webshell init')
    expect(state.calls).toEqual([])
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('keystore flags override the saved config', async () => {
    const { dependencies, state } = buildDependencies()

    await runWebshellBuild(
      { directory: '/tmp/webshell-app', keystoreAlias: 'override', keystorePath: '/keys/other.keystore' },
      dependencies,
    )

    expect(state.calls[0]?.cmd).toContain('-PSOLANA_MOBILE_KEYSTORE_PATH=/keys/other.keystore')
    expect(state.calls[0]?.cmd).toContain('-PSOLANA_MOBILE_KEYSTORE_ALIAS=override')
  })

  test('appends --stacktrace when flagged', async () => {
    const { dependencies, state } = buildDependencies()

    await runWebshellBuild({ directory: '/tmp/webshell-app', stacktrace: true }, dependencies)

    expect(state.calls[0]?.cmd.at(-1)).toBe('--stacktrace')
  })

  test('builds unsigned without keystore configuration and never resolves passwords', async () => {
    const { dependencies, state } = buildDependencies({
      readProjectConfig: async () => ({}),
      resolvePasswords: async () => {
        throw new Error('passwords should not be resolved')
      },
    })

    await runWebshellBuild({ directory: '/tmp/webshell-app' }, dependencies)

    expect(state.cancelled).toBeUndefined()
    expect(state.calls).toEqual([
      { cmd: ['/tmp/webshell-app/gradlew', 'assembleRelease'], options: { cwd: '/tmp/webshell-app', env: {} } },
    ])
    expect(state.logs.join('\n')).toContain('unsigned')
    expect(state.outro).toContain('app-release-unsigned.apk')
  })

  test('propagates a gradle failure as exit code 1 without advice', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = buildDependencies({
      runInteractiveCommand: async () => {
        throw new Error('gradlew exited with code 1')
      },
    })

    await runWebshellBuild({ directory: '/tmp/webshell-app' }, dependencies)

    expect(state.cancelled).toBe('Error: gradlew exited with code 1')
    expect(state.outro).toBeUndefined()
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('cancels before gradle when the password prompt is cancelled', async () => {
    const previousExitCode = process.exitCode
    const { dependencies, state } = buildDependencies({ resolvePasswords: async () => Symbol('cancelled') })

    await runWebshellBuild({ directory: '/tmp/webshell-app' }, dependencies)

    expect(state.cancelled).toBe('Cancelled')
    expect(state.calls).toEqual([])
    expect(process.exitCode).toBe(1)
    process.exitCode = previousExitCode
  })

  test('runInteractiveExecutable forwards cwd and env to the child process', async () => {
    await withTempDir(async (directory) => {
      // Writing through a relative path proves the cwd; the file contents prove the env made it through.
      await runInteractiveExecutable(['sh', '-c', 'printf "%s" "$WEBSHELL_TEST_VALUE" > marker.txt'], {
        cwd: directory,
        env: { WEBSHELL_TEST_VALUE: 'from-env' },
      })

      expect(await readFile(join(directory, 'marker.txt'), 'utf8')).toBe('from-env')
    })
  })
})

describe('webshell command registration', () => {
  test('delegates webshell init command options', async () => {
    const initOptions: WebshellInitCommandOptions[] = []
    const app = createApp({
      runWebshellInit: async (options) => {
        initOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'webshell',
      'init',
      'my-app',
      '--app-name',
      'My App',
      '--application-id',
      'com.example.myapp',
      '--force',
      '--keystore-alias',
      'release',
      '--keystore-path',
      'keys/release.keystore',
      '--manifest',
      'https://example.com/manifest.json',
      '--url',
      'https://example.com',
      '--version-code',
      '7',
      '--version-name',
      '1.2.3',
    ])

    expect(initOptions).toEqual([
      {
        applicationId: 'com.example.myapp',
        appName: 'My App',
        directory: 'my-app',
        force: true,
        keystoreAlias: 'release',
        keystorePath: 'keys/release.keystore',
        manifest: 'https://example.com/manifest.json',
        url: 'https://example.com',
        versionCode: 7,
        versionName: '1.2.3',
      },
    ])
  })

  test('delegates webshell build command options', async () => {
    const buildOptions: WebshellBuildCommandOptions[] = []
    const app = createApp({
      runWebshellBuild: async (options) => {
        buildOptions.push(options)
      },
    })

    await app.parseAsync([
      'node',
      'solana-mobile',
      'webshell',
      'build',
      'my-app',
      '--keystore-alias',
      'release',
      '--keystore-path',
      'keys/release.keystore',
      '--stacktrace',
    ])

    expect(buildOptions).toEqual([
      {
        directory: 'my-app',
        keystoreAlias: 'release',
        keystorePath: 'keys/release.keystore',
        stacktrace: true,
      },
    ])
  })

  test('rejects a webshell init --version-code that is not a positive integer', async () => {
    const app = createApp({ runWebshellInit: async () => {} })

    app.exitOverride()
    app.configureOutput({ writeErr: () => {}, writeOut: () => {} })

    const webshellCommand = app.commands.find((command) => command.name() === 'webshell')

    webshellCommand?.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} })
    webshellCommand?.commands
      .find((command) => command.name() === 'init')
      ?.exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })

    await expect(
      app.parseAsync(['node', 'solana-mobile', 'webshell', 'init', '--version-code', 'abc']),
    ).rejects.toThrow('Expected a positive integer, received: abc')
  })

  test('prints webshell help without delegating when no subcommand is given', async () => {
    const output: string[] = []
    let initCalled = false
    const app = createApp({
      runWebshellInit: async () => {
        initCalled = true
      },
    })

    app.commands
      .find((command) => command.name() === 'webshell')
      ?.configureOutput({
        writeErr: () => {},
        writeOut: (chunk: string) => {
          output.push(chunk)
        },
      })

    await app.parseAsync(['node', 'solana-mobile', 'webshell'])

    expect(output.join('')).toContain('Commands:')
    expect(output.join('')).toContain('init')
    expect(output.join('')).toContain('build')
    expect(initCalled).toBe(false)
  })
})
