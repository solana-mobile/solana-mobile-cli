import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { listAndroidSdkRootCandidates } from '../../core/data-access/android-sdk-root.ts'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import { findExecutable } from '../../core/data-access/executable-lookup.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { ApkBadging, ApkInspection, ApkSigner } from './release-types.ts'

export interface InspectApkDependencies {
  environment?: NodeJS.ProcessEnv
  pathExists?: (path: string) => Promise<boolean>
  platform?: NodeJS.Platform
  readDirectory?: (path: string) => Promise<string[]>
  runCommand?: CommandRunner
}

/**
 * Reads what the dApp Store will see in a built APK: the manifest values through `aapt2 dump badging`
 * (or `aapt`, whose output is the same) and the signing certificates through `apksigner verify`. A tool
 * that cannot be found is reported by name instead of throwing, so the rest of the report still prints.
 */
export async function inspectApk(path: string, dependencies: InspectApkDependencies = {}): Promise<ApkInspection> {
  const { pathExists = exists, runCommand = runExecutable } = dependencies

  if (!(await pathExists(path))) {
    return { exists: false, missingTools: [], path }
  }

  const tools = await findApkTools({ ...dependencies, pathExists })
  const inspection: ApkInspection = { exists: true, missingTools: [], path }

  if (tools.aapt) {
    try {
      inspection.badging = parseApkBadging(await runCommand([tools.aapt, 'dump', 'badging', path]))
    } catch (error) {
      inspection.badgingError = toolError(error)
    }
  } else {
    inspection.missingTools.push('aapt2')
  }

  if (tools.apksigner) {
    try {
      inspection.signers = parseApkSigners(await runCommand([tools.apksigner, 'verify', '--print-certs', path]))
    } catch (error) {
      // apksigner exits non-zero for an unsigned APK or a signature that does not verify.
      inspection.signatureError = toolError(error)
    }
  } else {
    inspection.missingTools.push('apksigner')
  }

  return inspection
}

/**
 * Looks in every installed Build-Tools version, newest first, under each SDK root candidate, then on
 * PATH. `aapt2` is preferred; `aapt` prints the same badging and covers older or distro-packaged tools.
 */
export async function findApkTools({
  environment = process.env,
  pathExists = exists,
  platform = process.platform,
  readDirectory = listDirectory,
}: InspectApkDependencies = {}): Promise<{ aapt?: string; apksigner?: string }> {
  const preferredDirectories: string[] = []
  for (const { path: sdkRoot } of listAndroidSdkRootCandidates({ environment, platform })) {
    const buildTools = join(sdkRoot, 'build-tools')
    const versions = (await readDirectory(buildTools).catch(() => [])).filter((entry) =>
      BUILD_TOOLS_VERSION.test(entry),
    )
    versions.sort(compareBuildToolsVersionsDescending)
    preferredDirectories.push(...versions.map((version) => join(buildTools, version)))
  }

  const options = { environment, pathExists, platform, preferredDirectories }
  return {
    aapt: (await findExecutable('aapt2', options)) ?? (await findExecutable('aapt', options)),
    apksigner: await findExecutable('apksigner', options),
  }
}

/** A release such as `35.0.1`, or a preview such as `34.0.0-rc1`. */
const BUILD_TOOLS_VERSION = /^\d+(?:\.\d+)*(?:-rc\d+)?$/

/** Newest first, and a final release before the previews of the same version. */
export function compareBuildToolsVersionsDescending(left: string, right: string) {
  const [leftVersion = '', leftPreview] = left.split('-')
  const [rightVersion = '', rightPreview] = right.split('-')
  const byVersion = rightVersion.localeCompare(leftVersion, 'en', { numeric: true })
  if (byVersion !== 0) return byVersion
  if (!leftPreview || !rightPreview) return leftPreview ? 1 : rightPreview ? -1 : 0
  return rightPreview.localeCompare(leftPreview, 'en', { numeric: true })
}

export function parseApkBadging(output: string): ApkBadging {
  const packageLine = output.match(/^package:(.*)$/m)?.[1] ?? ''
  const attribute = (name: string) => packageLine.match(new RegExp(`\\b${name}='([^']*)'`))?.[1]
  const versionCode = attribute('versionCode')

  return {
    debuggable: /^application-debuggable\s*$/m.test(output),
    packageName: attribute('name'),
    versionCode: versionCode && /^\d+$/.test(versionCode) ? Number(versionCode) : undefined,
    versionName: attribute('versionName'),
  }
}

/**
 * Older `apksigner` releases print `Signer #1 certificate DN: …`; Build-Tools 35 and later print the
 * signer per signature scheme, as in `V2 Signer: certificate DN: …` and `V3.0 Signer: …`, and a v3.1
 * signature names its signers by SDK range, as in `Signer (minSdkVersion=33 (dev release=true), …)`.
 * Any label that names a signer is accepted rather than an enumerated set, since a certificate the
 * parser skips is one the debug check never sees; only the source stamp, which is not an app signer,
 * is left out. The same certificate can show up more than once, so signers are de-duplicated by
 * certificate.
 */
export function parseApkSigners(output: string): ApkSigner[] {
  const signers = new Map<string, ApkSigner>()
  const line = /^(?!Source Stamp)([^\n]*?\bSigner\b[^\n]*?):? certificate (DN|SHA-256 digest): (.+)$/gm
  for (const [, label, field, value] of output.matchAll(line)) {
    const signer = signers.get(label as string) ?? { dn: '' }
    if (field === 'DN') signer.dn = (value as string).trim()
    else signer.sha256 = (value as string).trim()
    signers.set(label as string, signer)
  }

  const unique = new Map<string, ApkSigner>()
  for (const signer of signers.values()) unique.set(`${signer.dn}\n${signer.sha256 ?? ''}`, signer)
  return [...unique.values()]
}

/** The certificate Android's build tools generate for debug builds is always issued to `CN=Android Debug`. */
export function isDebugCertificate(signer: ApkSigner) {
  return /(?:^|,\s*)CN=Android Debug(?:,|$)/.test(signer.dn)
}

/**
 * The JVM announces `JAVA_TOOL_OPTIONS` on stderr before apksigner says anything, and apksigner follows
 * a malformed APK with a Java stack trace; both bury the line that explains the failure, so the notice
 * and the stack frames are dropped.
 */
export function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .split('\n')
    .filter((line) => !line.startsWith('Picked up ') && !/^\s+(?:at |\.\.\. \d+ more)/.test(line))
    .join('\n')
    .trim()
}

async function listDirectory(path: string) {
  return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name)
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
