import { confirm, log, password, text } from '@clack/prompts'
import { resolvePromptCancellation, type TextPrompt } from '../../core/ui/core-ui-prompt-types.ts'
import {
  WEBSHELL_KEY_PASSWORD_ENV,
  WEBSHELL_KEYSTORE_PASSWORD_ENV,
  type WebshellSigningPasswords,
} from '../data-access/keystore.ts'
import { validateWebshellApplicationId } from '../data-access/rename-android-package.ts'

/** Google Play rejects anything above this versionCode. */
const MAX_ANDROID_VERSION_CODE = 2_100_000_000
const MIN_KEYSTORE_PASSWORD_LENGTH = 6

export const WEBSHELL_DEFAULT_KEYSTORE_ALIAS = 'android'
export const WEBSHELL_DEFAULT_KEYSTORE_FILENAME = 'android.keystore'
export const WEBSHELL_DEFAULT_VERSION_CODE = 1
export const WEBSHELL_DEFAULT_VERSION_NAME = '1.0'

export type ConfirmPrompt = (options: { initialValue?: boolean; message: string }) => Promise<boolean | symbol>

export type PasswordPrompt = (options: {
  message: string
  validate?: (value: string) => string | undefined
}) => Promise<string | symbol>

/** Parses and re-serializes the URL so the rest of the flow only ever sees a canonical http(s) URL. */
export function normalizeWebshellUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error(`Invalid URL: ${value}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL must use http or https: ${value}`)
  }

  return parsed.toString()
}

export function validateWebshellUrl(value: string): string | undefined {
  if (!value.trim()) {
    return 'Web app URL is required.'
  }

  try {
    normalizeWebshellUrl(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid URL.'
  }
}

export interface WebshellApplicationIdSuggestion {
  applicationId?: string
  note?: string
}

/**
 * Suggests an Android application id by reversing the host of the web app URL, the same way Bubblewrap
 * seeds its default. Reserved Kotlin words are left untouched here — they are legal in an application
 * id, and the package rename step rewrites them for the Kotlin namespace separately.
 */
export function deriveWebshellApplicationIdSuggestion(url: string): WebshellApplicationIdSuggestion {
  let parsed: URL
  try {
    parsed = new URL(normalizeWebshellUrl(url))
  } catch {
    return {}
  }

  const host = parsed.hostname.trim().toLowerCase()
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return {}
  }

  const segmentResults = host
    .split('.')
    .reverse()
    .map((segment) => normalizeSuggestionSegment(segment))
  const segments = segmentResults
    .map((result) => result.normalized)
    .filter((segment): segment is string => Boolean(segment))

  if (segments.length < 2) {
    return {}
  }

  const applicationId = segments.join('.')
  if (validateWebshellApplicationId(applicationId)) {
    return {}
  }

  if (segmentResults.some((result) => result.adjusted)) {
    return {
      applicationId,
      note: `Adjusted the default application ID to ${applicationId} to keep it Android-safe.`,
    }
  }

  return { applicationId }
}

export async function promptWebshellUrl(
  defaultValue?: string,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'Web app URL',
    placeholder: defaultValue ? undefined : 'https://example.com',
    validate: validateWebshellUrl,
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return normalizeWebshellUrl(entered)
}

export async function promptWebshellApplicationId(
  defaultValue?: string,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'Android application ID',
    placeholder: defaultValue ? undefined : 'com.example.app',
    validate: (value) => (value.trim() ? validateWebshellApplicationId(value.trim()) : 'Application ID is required.'),
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return entered.trim()
}

export async function promptWebshellAppName(
  defaultValue?: string,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'App name',
    validate: (value) => (value.trim() ? undefined : 'App name is required.'),
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return entered.trim()
}

export function validateWebshellVersionCode(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return 'Android version code is required.'
  }

  if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) <= 0) {
    return 'Android version code must be a positive integer.'
  }

  if (Number.parseInt(trimmed, 10) > MAX_ANDROID_VERSION_CODE) {
    return `Android version code must be ${MAX_ANDROID_VERSION_CODE} or lower.`
  }

  return undefined
}

export async function promptWebshellVersionCode(
  defaultValue: number = WEBSHELL_DEFAULT_VERSION_CODE,
  runText: TextPrompt = text as TextPrompt,
): Promise<number | undefined> {
  const entered = await runText({
    defaultValue: String(defaultValue),
    initialValue: String(defaultValue),
    message: 'Android version code',
    validate: validateWebshellVersionCode,
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return Number.parseInt(entered.trim(), 10)
}

export async function promptWebshellVersionName(
  defaultValue: string = WEBSHELL_DEFAULT_VERSION_NAME,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'Android version name',
    validate: (value) => (value.trim() ? undefined : 'Android version name is required.'),
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return entered.trim()
}

export async function promptWebshellKeystorePath(
  defaultValue?: string,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'Signing keystore path (created when missing)',
    validate: (value) => (value.trim() ? undefined : 'Signing keystore path is required.'),
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return entered.trim()
}

export async function promptWebshellKeystoreAlias(
  defaultValue: string = WEBSHELL_DEFAULT_KEYSTORE_ALIAS,
  runText: TextPrompt = text as TextPrompt,
): Promise<string | undefined> {
  const entered = await runText({
    defaultValue,
    initialValue: defaultValue,
    message: 'Signing key alias',
    validate: (value) => (value.trim() ? undefined : 'Signing key alias is required.'),
  })

  if (typeof entered === 'symbol') {
    return resolvePromptCancellation(entered)
  }

  return entered.trim()
}

export interface ResolveWebshellCreatePasswordsDependencies {
  env?: Partial<Record<string, string>>
  logError?: (message: string) => void
  runConfirm?: ConfirmPrompt
  runPassword?: PasswordPrompt
}

/**
 * Resolves the passwords used to create a brand-new keystore. The environment variables win so
 * automated runs never prompt; interactive runs get a confirmed-password flow because a typo here
 * produces a keystore nobody can ever sign an update with again. A cancelled prompt returns the
 * cancel symbol for the caller to handle.
 */
export async function resolveWebshellCreatePasswords({
  env = process.env,
  logError = log.error,
  runConfirm = confirm as ConfirmPrompt,
  runPassword = password as PasswordPrompt,
}: ResolveWebshellCreatePasswordsDependencies = {}): Promise<WebshellSigningPasswords | symbol> {
  const envKeyPassword = env[WEBSHELL_KEY_PASSWORD_ENV]?.trim()
  const envKeystorePassword = env[WEBSHELL_KEYSTORE_PASSWORD_ENV]?.trim()

  // keytool -genkeypair rejects passwords shorter than 6 characters; catching env values here fails
  // before any project files are written.
  if (envKeystorePassword && envKeystorePassword.length < MIN_KEYSTORE_PASSWORD_LENGTH) {
    throw new Error(`${WEBSHELL_KEYSTORE_PASSWORD_ENV} must be at least ${MIN_KEYSTORE_PASSWORD_LENGTH} characters.`)
  }
  if (envKeyPassword && envKeyPassword.length < MIN_KEYSTORE_PASSWORD_LENGTH) {
    throw new Error(`${WEBSHELL_KEY_PASSWORD_ENV} must be at least ${MIN_KEYSTORE_PASSWORD_LENGTH} characters.`)
  }

  if (envKeystorePassword) {
    return { keyPassword: envKeyPassword || envKeystorePassword, keystorePassword: envKeystorePassword }
  }

  const keystorePassword = await promptConfirmedPassword('Keystore password', { logError, runPassword })
  if (typeof keystorePassword === 'symbol') {
    return keystorePassword
  }

  if (envKeyPassword) {
    return { keyPassword: envKeyPassword, keystorePassword }
  }

  const useSamePassword = await runConfirm({
    initialValue: true,
    message: 'Use the same password for the signing key?',
  })
  if (typeof useSamePassword === 'symbol') {
    return useSamePassword
  }

  if (useSamePassword) {
    return { keyPassword: keystorePassword, keystorePassword }
  }

  const keyPassword = await promptConfirmedPassword('Signing key password', { logError, runPassword })
  if (typeof keyPassword === 'symbol') {
    return keyPassword
  }

  return { keyPassword, keystorePassword }
}

async function promptConfirmedPassword(
  label: string,
  { logError, runPassword }: { logError: (message: string) => void; runPassword: PasswordPrompt },
): Promise<string | symbol> {
  while (true) {
    const entered = await runPassword({ message: label, validate: validateCreatePassword(label) })
    if (typeof entered === 'symbol') {
      return entered
    }

    const confirmed = await runPassword({
      message: `Confirm ${label.toLowerCase()}`,
      validate: validateCreatePassword(label),
    })
    if (typeof confirmed === 'symbol') {
      return confirmed
    }

    if (entered === confirmed) {
      return entered
    }

    logError('Passwords do not match. Try again.')
  }
}

function validateCreatePassword(label: string): (value: string) => string | undefined {
  return (value) => {
    if (!value.trim()) {
      return `${label} is required.`
    }

    if (value.trim().length < MIN_KEYSTORE_PASSWORD_LENGTH) {
      return `${label} must be at least ${MIN_KEYSTORE_PASSWORD_LENGTH} characters.`
    }

    return undefined
  }
}

interface NormalizedSuggestionSegment {
  adjusted: boolean
  normalized?: string
}

function normalizeSuggestionSegment(value: string): NormalizedSuggestionSegment {
  let normalized = value
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!normalized) {
    return { adjusted: true }
  }

  let adjusted = normalized !== value

  if (!/^[a-z]/.test(normalized)) {
    normalized = `app${normalized}`
    adjusted = true
  }

  return { adjusted, normalized }
}
