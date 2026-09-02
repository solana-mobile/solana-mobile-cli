import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { password } from '@clack/prompts'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'

export const WEBSHELL_KEY_PASSWORD_ENV = 'SOLANA_MOBILE_KEY_PASSWORD'
export const WEBSHELL_KEYSTORE_PASSWORD_ENV = 'SOLANA_MOBILE_KEYSTORE_PASSWORD'

export type WebshellPasswordPrompt = (options: { message: string }) => Promise<string | symbol>

export interface WebshellSigningPasswords {
  keyPassword: string
  keystorePassword: string
}

export interface ResolveWebshellSigningPasswordsDependencies {
  env?: Partial<Record<string, string>>
  promptPassword?: WebshellPasswordPrompt
}

export interface EnsureKeystoreOptions {
  appName: string
  keyPassword: string
  keystoreAlias: string
  keystorePassword: string
  keystorePath: string
}

export interface EnsureKeystoreDependencies {
  runCommand?: CommandRunner
}

const defaultPasswordPrompt: WebshellPasswordPrompt = ({ message }) =>
  password({ message, validate: (value) => (value?.trim() ? undefined : 'A password is required.') })

/**
 * Resolves the signing passwords from `SOLANA_MOBILE_KEYSTORE_PASSWORD` / `SOLANA_MOBILE_KEY_PASSWORD`,
 * falling back to a hidden prompt for the keystore password. The key password defaults to the keystore
 * password when its variable is unset. A cancelled prompt returns the clack cancel symbol for the
 * caller to handle.
 */
export async function resolveWebshellSigningPasswords({
  env = process.env,
  promptPassword = defaultPasswordPrompt,
}: ResolveWebshellSigningPasswordsDependencies = {}): Promise<WebshellSigningPasswords | symbol> {
  const keystorePassword =
    env[WEBSHELL_KEYSTORE_PASSWORD_ENV]?.trim() ||
    (await promptPassword({ message: `Keystore password (${WEBSHELL_KEYSTORE_PASSWORD_ENV} is not set)` }))
  if (typeof keystorePassword === 'symbol') {
    return keystorePassword
  }

  return {
    keyPassword: env[WEBSHELL_KEY_PASSWORD_ENV]?.trim() || keystorePassword,
    keystorePassword,
  }
}

/**
 * Creates the signing keystore with `keytool -genkeypair` when it does not exist yet. Returns true
 * when a new keystore was generated, false when the existing file is kept.
 */
export async function ensureKeystore(
  options: EnsureKeystoreOptions,
  { runCommand = runExecutable }: EnsureKeystoreDependencies = {},
): Promise<boolean> {
  if (await exists(options.keystorePath)) {
    return false
  }

  await mkdir(dirname(options.keystorePath), { recursive: true })
  // Passwords must never appear in argv — keytool reads them from the child env via `:env`.
  await runCommand(
    [
      'keytool',
      '-genkeypair',
      '-v',
      '-keystore',
      options.keystorePath,
      '-alias',
      options.keystoreAlias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass:env',
      WEBSHELL_KEYSTORE_PASSWORD_ENV,
      '-keypass:env',
      WEBSHELL_KEY_PASSWORD_ENV,
      '-dname',
      buildDname(options.appName),
      '-noprompt',
    ],
    {
      env: {
        [WEBSHELL_KEY_PASSWORD_ENV]: options.keyPassword,
        [WEBSHELL_KEYSTORE_PASSWORD_ENV]: options.keystorePassword,
      },
    },
  )

  return true
}

function buildDname(appName: string): string {
  const commonName = sanitizeDistinguishedNameValue(appName) || 'Solana Mobile Web Shell'

  return `CN=${commonName}, OU=Unknown, O=Unknown, L=Unknown, ST=Unknown, C=US`
}

function sanitizeDistinguishedNameValue(value: string): string {
  return value
    .replace(/["+,;<>#=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
