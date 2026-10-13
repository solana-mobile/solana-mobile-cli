import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import {
  SIGNING_KEY_PASSWORD_ENV,
  SIGNING_KEYSTORE_PASSWORD_ENV,
  type SigningPasswords,
} from '../../core/data-access/signing-passwords.ts'
import { toolError } from './inspect-apk.ts'

export interface SignApkOptions {
  apksigner: string
  input: string
  keystoreAlias: string
  keystorePath: string
  output: string
  passwords: SigningPasswords
}

export interface SignApkDependencies {
  runCommand?: CommandRunner
}

/**
 * Signs `input` into `output` with `apksigner sign`, which replaces any signature the APK already
 * carries, such as the debug one the prebuild template gives release builds. Passwords never appear
 * in argv: apksigner reads them from the child env through its `env:` password sources.
 */
export async function signApk(
  options: SignApkOptions,
  { runCommand = runExecutable }: SignApkDependencies = {},
): Promise<void> {
  await mkdir(dirname(options.output), { recursive: true })
  try {
    await runCommand(
      [
        options.apksigner,
        'sign',
        '--ks',
        options.keystorePath,
        '--ks-key-alias',
        options.keystoreAlias,
        '--ks-pass',
        `env:${SIGNING_KEYSTORE_PASSWORD_ENV}`,
        '--key-pass',
        `env:${SIGNING_KEY_PASSWORD_ENV}`,
        // A v4 signature is a separate .idsig file that only incremental adb installs use.
        '--v4-signing-enabled',
        'false',
        '--out',
        options.output,
        options.input,
      ],
      {
        env: {
          [SIGNING_KEY_PASSWORD_ENV]: options.passwords.keyPassword,
          [SIGNING_KEYSTORE_PASSWORD_ENV]: options.passwords.keystorePassword,
        },
      },
    )
  } catch (error) {
    // A wrong password or alias surfaces as a Java stack trace; its first lines say which.
    throw new Error(`apksigner could not sign the APK with ${options.keystorePath}:\n${toolError(error)}`)
  }
}
