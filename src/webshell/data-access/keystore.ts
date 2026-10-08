import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import { SIGNING_KEY_PASSWORD_ENV, SIGNING_KEYSTORE_PASSWORD_ENV } from '../../core/data-access/signing-passwords.ts'

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
      SIGNING_KEYSTORE_PASSWORD_ENV,
      '-keypass:env',
      SIGNING_KEY_PASSWORD_ENV,
      '-dname',
      buildDname(options.appName),
      '-noprompt',
    ],
    {
      env: {
        [SIGNING_KEY_PASSWORD_ENV]: options.keyPassword,
        [SIGNING_KEYSTORE_PASSWORD_ENV]: options.keystorePassword,
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
