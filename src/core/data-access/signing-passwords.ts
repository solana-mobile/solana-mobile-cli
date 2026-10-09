import { password } from '@clack/prompts'

export const SIGNING_KEY_PASSWORD_ENV = 'SOLANA_MOBILE_KEY_PASSWORD'
export const SIGNING_KEYSTORE_PASSWORD_ENV = 'SOLANA_MOBILE_KEYSTORE_PASSWORD'

export type PasswordPrompt = (options: { message: string }) => Promise<string | symbol>

export interface SigningPasswords {
  keyPassword: string
  keystorePassword: string
}

export interface ResolveSigningPasswordsDependencies {
  env?: Partial<Record<string, string>>
  promptPassword?: PasswordPrompt
}

const defaultPasswordPrompt: PasswordPrompt = ({ message }) =>
  password({ message, validate: (value) => (value?.trim() ? undefined : 'A password is required.') })

/**
 * Resolves the signing passwords from `SOLANA_MOBILE_KEYSTORE_PASSWORD` / `SOLANA_MOBILE_KEY_PASSWORD`,
 * falling back to a hidden prompt for the keystore password. The key password defaults to the keystore
 * password when its variable is unset. A cancelled prompt returns the clack cancel symbol for the
 * caller to handle.
 */
export async function resolveSigningPasswords({
  env = process.env,
  promptPassword = defaultPasswordPrompt,
}: ResolveSigningPasswordsDependencies = {}): Promise<SigningPasswords | symbol> {
  const keystorePassword =
    env[SIGNING_KEYSTORE_PASSWORD_ENV]?.trim() ||
    (await promptPassword({ message: `Keystore password (${SIGNING_KEYSTORE_PASSWORD_ENV} is not set)` }))
  if (typeof keystorePassword === 'symbol') {
    return keystorePassword
  }

  return {
    keyPassword: env[SIGNING_KEY_PASSWORD_ENV]?.trim() || keystorePassword,
    keystorePassword,
  }
}
