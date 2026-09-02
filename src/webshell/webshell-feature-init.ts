import { access } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { cancel, log as clackLog, intro, outro } from '@clack/prompts'
import type { CommandRunner } from '../core/data-access/command-types.ts'
import { formatCliCommand } from '../core/util/format-cli-command.ts'
import type { TextPrompt } from '../emulator/ui/emulator-ui-prompt-types.ts'
import { applyWebshellBranding } from './data-access/apply-branding.ts'
import { copyWebshellTemplate } from './data-access/copy-template.ts'
import { findWebshellTemplateDir } from './data-access/find-template-dir.ts'
import {
  ensureKeystore,
  WEBSHELL_KEY_PASSWORD_ENV,
  WEBSHELL_KEYSTORE_PASSWORD_ENV,
  type WebshellSigningPasswords,
} from './data-access/keystore.ts'
import { writeWebshellProjectConfig } from './data-access/project-config.ts'
import { readWebshellManifest, type WebshellManifest } from './data-access/read-manifest.ts'
import {
  deriveWebshellPackageName,
  renameAndroidPackage,
  validateWebshellApplicationId,
} from './data-access/rename-android-package.ts'
import type { WebshellInitCommandOptions } from './data-access/webshell-types.ts'
import {
  deriveWebshellApplicationIdSuggestion,
  normalizeWebshellUrl,
  promptWebshellApplicationId,
  promptWebshellAppName,
  promptWebshellKeystoreAlias,
  promptWebshellKeystorePath,
  promptWebshellUrl,
  promptWebshellVersionCode,
  promptWebshellVersionName,
  resolveWebshellCreatePasswords,
  WEBSHELL_DEFAULT_KEYSTORE_FILENAME,
} from './ui/webshell-ui-prompts.ts'

export interface RunWebshellInitDependencies {
  applyBranding?: typeof applyWebshellBranding
  cancel?: (message: string) => void
  copyTemplate?: typeof copyWebshellTemplate
  createKeystore?: typeof ensureKeystore
  env?: Partial<Record<string, string>>
  fetchFn?: (url: URL) => Promise<Response>
  fileExists?: (path: string) => Promise<boolean>
  findTemplateDir?: typeof findWebshellTemplateDir
  formatCommand?: typeof formatCliCommand
  intro?: (message: string) => void
  log?: (message: string) => void
  outro?: (message: string) => void
  readManifest?: typeof readWebshellManifest
  renamePackage?: typeof renameAndroidPackage
  resolvePasswords?: typeof resolveWebshellCreatePasswords
  runCommand?: CommandRunner
  runText?: TextPrompt
  warn?: (message: string) => void
  writeProjectConfig?: typeof writeWebshellProjectConfig
}

/**
 * Generates an Android WebView-shell project for a web app. Every value resolves flag > manifest >
 * prompt, so a fully flagged invocation (or one seeded by a complete Bubblewrap manifest) never
 * prompts — that is what lets CI drive it.
 */
export async function runWebshellInit(
  options: WebshellInitCommandOptions = {},
  dependencies: RunWebshellInitDependencies = {},
) {
  const {
    applyBranding = applyWebshellBranding,
    cancel: showCancel = cancel,
    copyTemplate = copyWebshellTemplate,
    createKeystore = ensureKeystore,
    env = process.env,
    fetchFn = (url: URL) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    fileExists = defaultFileExists,
    findTemplateDir = findWebshellTemplateDir,
    formatCommand = formatCliCommand,
    intro: showIntro = intro,
    log = clackLog.message,
    outro: showOutro = outro,
    readManifest = readWebshellManifest,
    renamePackage = renameAndroidPackage,
    resolvePasswords = resolveWebshellCreatePasswords,
    runCommand,
    runText,
    warn = clackLog.warn,
    writeProjectConfig = writeWebshellProjectConfig,
  } = dependencies

  try {
    showIntro('solana-mobile webshell init')

    const targetDirectory = resolve(options.directory ?? '.')

    // A Bubblewrap manifest's linked web manifest is loaded too; a broken link only costs branding, never the init.
    const manifest = options.manifest ? await readManifest(options.manifest, { fetchFn }) : undefined
    let webManifest = manifest?.kind === 'web' ? manifest : undefined
    if (manifest && !webManifest && manifest.webManifestUrl) {
      try {
        webManifest = await readManifest(manifest.webManifestUrl, { fetchFn })
      } catch (error) {
        warn(`Skipping the linked web manifest: ${error instanceof Error ? error.message : error}`)
      }
    }
    if (manifest) {
      log(`Loaded ${manifest.kind === 'bubblewrap' ? 'Bubblewrap' : 'web'} manifest from ${manifest.source}`)
    }

    const seededUrl = trimmedOrUndefined(options.url) ?? manifest?.url ?? webManifest?.url
    const url = seededUrl ? normalizeWebshellUrl(seededUrl) : await promptWebshellUrl(undefined, runText)
    if (url === undefined) {
      return
    }

    let applicationId = trimmedOrUndefined(options.applicationId) ?? manifest?.applicationId
    if (applicationId) {
      const validationError = validateWebshellApplicationId(applicationId)
      if (validationError) {
        throw new Error(validationError)
      }
    } else {
      const suggestion = deriveWebshellApplicationIdSuggestion(url)
      if (suggestion.note) {
        log(suggestion.note)
      }
      applicationId = await promptWebshellApplicationId(suggestion.applicationId, runText)
      if (applicationId === undefined) {
        return
      }
    }

    const packageName = deriveWebshellPackageName(applicationId)
    if (packageName.note) {
      log(packageName.note)
    }

    const appName =
      trimmedOrUndefined(options.appName) ??
      manifest?.appName ??
      webManifest?.appName ??
      (await promptWebshellAppName(undefined, runText))
    if (appName === undefined) {
      return
    }

    const versionCode =
      options.versionCode ?? manifest?.versionCode ?? (await promptWebshellVersionCode(undefined, runText))
    if (versionCode === undefined) {
      return
    }

    const versionName =
      trimmedOrUndefined(options.versionName) ??
      manifest?.versionName ??
      (await promptWebshellVersionName(undefined, runText))
    if (versionName === undefined) {
      return
    }

    const enteredKeystorePath =
      trimmedOrUndefined(options.keystorePath) ??
      resolveManifestKeystorePath(manifest) ??
      (await promptWebshellKeystorePath(join(targetDirectory, WEBSHELL_DEFAULT_KEYSTORE_FILENAME), runText))
    if (enteredKeystorePath === undefined) {
      return
    }
    // A relative keystore path belongs to the project being generated, not to wherever init was invoked.
    const keystorePath = resolve(targetDirectory, enteredKeystorePath)

    const keystoreAlias =
      trimmedOrUndefined(options.keystoreAlias) ??
      manifest?.keystoreAlias ??
      (await promptWebshellKeystoreAlias(undefined, runText))
    if (keystoreAlias === undefined) {
      return
    }

    // Resolved before any project files are written, so a cancelled password prompt leaves no
    // half-generated directory behind.
    let keystorePasswords: WebshellSigningPasswords | undefined
    if (!(await fileExists(keystorePath))) {
      const passwords = await resolvePasswords({ env })
      if (typeof passwords === 'symbol') {
        showCancel('Cancelled')
        process.exitCode = 1
        return
      }
      keystorePasswords = passwords
    }

    await copyTemplate(findTemplateDir(), targetDirectory, { force: options.force })
    await renamePackage(targetDirectory, {
      applicationId,
      appName,
      keystoreAlias,
      keystorePath,
      projectName: basename(targetDirectory) || appName,
      url,
      versionCode,
      versionName,
    })
    await applyBranding(targetDirectory, webManifest, { fetchFn, logWarning: warn })

    if (keystorePasswords === undefined) {
      log(`Using the existing signing keystore at ${keystorePath}`)
    } else {
      log(
        `Creating a signing keystore at ${keystorePath}. Keep the file and its passwords safe: app updates must be signed with the same key.`,
      )
      await createKeystore(
        {
          appName,
          keyPassword: keystorePasswords.keyPassword,
          keystoreAlias,
          keystorePassword: keystorePasswords.keystorePassword,
          keystorePath,
        },
        runCommand ? { runCommand } : {},
      )
    }

    // Stored Bubblewrap-style: project-relative when the keystore lives inside the project, so the
    // generated project stays portable across machines.
    const keystorePathInProject = relative(targetDirectory, keystorePath)
    const savedKeystorePath =
      keystorePathInProject.startsWith('..') || isAbsolute(keystorePathInProject) ? keystorePath : keystorePathInProject

    await writeProjectConfig(targetDirectory, {
      applicationId,
      appName,
      keystoreAlias,
      keystorePath: savedKeystorePath,
      url,
      webManifestUrl: webManifest?.webManifestUrl ?? manifest?.webManifestUrl,
    })

    log(`Set ${WEBSHELL_KEYSTORE_PASSWORD_ENV} and ${WEBSHELL_KEY_PASSWORD_ENV} to skip password prompts during builds`)
    showOutro(`Generated ${appName} in ${targetDirectory}. Next: ${formatCommand(`webshell build ${targetDirectory}`)}`)
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}

function defaultFileExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/** A relative signingKey path in a local twa-manifest.json is relative to that file, not to our cwd. */
function resolveManifestKeystorePath(manifest?: WebshellManifest): string | undefined {
  const candidate = manifest?.keystorePath?.trim()
  if (!candidate) {
    return undefined
  }

  if (isAbsolute(candidate)) {
    return candidate
  }

  const source = manifest?.source
  if (source && !source.startsWith('http://') && !source.startsWith('https://')) {
    return resolve(dirname(source), candidate)
  }

  return candidate
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed ? trimmed : undefined
}
