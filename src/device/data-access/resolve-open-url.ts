/**
 * `device open 3000` means "the dev server on this computer", so a bare port becomes a localhost URL.
 * Anything carrying a scheme is passed through untouched — the VIEW intent handles deep links like
 * `myapp://claim` just as well as web URLs. A bare host gets `http://` because the intent needs a URI.
 */
export function resolveOpenUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Expected a URL or port')
  }

  if (/^\d+$/.test(trimmed)) {
    const port = Number(trimmed)

    if (port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${trimmed}`)
    }

    return `http://localhost:${port}`
  }

  // `localhost:3000` parses as scheme `localhost:`, so host:port is claimed before the scheme check.
  if (/^[a-z0-9.-]+:\d+(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

/** Shaped for clack's `validate`: an error message blocks submission, `undefined` accepts. */
export function validateOpenUrlInput(value: string): string | undefined {
  try {
    resolveOpenUrl(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const LOCALHOST_NAMES = ['127.0.0.1', '[::1]', 'localhost']

/**
 * The device port a localhost URL needs reversed, or `undefined` when the URL leaves the host — or
 * names no explicit port, since `adb reverse` on a privileged port would fail as the shell user anyway.
 */
export function localhostPort(url: string): number | undefined {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  if (!LOCALHOST_NAMES.includes(parsed.hostname) || !parsed.port) {
    return undefined
  }

  return Number(parsed.port)
}
