import {
  captureException,
  createStackParser,
  createTransport,
  flush,
  getClient,
  getIsolationScope,
  metrics,
  type ErrorEvent,
  type StackFrame,
  setCurrentClient,
} from '@sentry/core'
import { nodeStackLineParser, ServerRuntimeClient } from '@sentry/core/server'
import type { PackageMetadata } from '../../core/data-access/package-metadata.ts'

const FLUSH_TIMEOUT_MS = 2000

// shortcut: empty until the `solana-mobile-cli` Sentry project exists, and telemetry never sends
// while it is. Fill in the project's DSN to switch it on.
export const TELEMETRY_DSN = ''

export type TelemetryClientOptions = {
  dsn: string
  installId: string
  metadata: PackageMetadata
}

/**
 * Starts the Sentry client. Built on `@sentry/core` instead of `@sentry/node`, which would pull
 * OpenTelemetry and the Sentry CLI binary into every `npx` install. With no default integrations,
 * nothing is collected implicitly: no console breadcrumbs, no hostname, no request data.
 */
export function initTelemetryClient({ dsn, installId, metadata }: TelemetryClientOptions): void {
  const runtime = process.versions.bun ? 'bun' : 'node'
  const runtimeVersion = process.versions.bun ?? process.versions.node

  const client = new ServerRuntimeClient({
    beforeSend: toCrashEvent,
    dsn,
    integrations: [],
    platform: 'node',
    release: metadata.version,
    runtime: { name: runtime, version: runtimeVersion },
    sendDefaultPii: false,
    stackParser: createStackParser(nodeStackLineParser()),
    transport: (transportOptions) =>
      createTransport(transportOptions, async (request) => {
        const response = await fetch(transportOptions.url, {
          // Sentry types the envelope as a Uint8Array over any ArrayBufferLike, which fetch's types reject
          body: request.body as BodyInit,
          method: 'POST',
          signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        })

        return {
          headers: {
            'retry-after': response.headers.get('retry-after'),
            'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
          },
          statusCode: response.status,
        }
      }),
  })

  setCurrentClient(client)
  client.init()

  setTelemetryAttributes({
    arch: process.arch,
    cli_version: metadata.version,
    install_id: installId,
    os: process.platform,
    runtime,
    runtime_version: runtimeVersion,
  })
}

/**
 * Attaches attributes to everything sent for the rest of the run: as metric attributes for usage
 * counts and as tags on crash reports. Harmless when telemetry is off, since nothing is ever sent.
 */
export function setTelemetryAttributes(attributes: Record<string, string>): void {
  getIsolationScope().setAttributes(attributes).setTags(attributes)
}

/**
 * Records how the command ended and sends everything before the process exits. Never throws and
 * never waits longer than the flush timeout, so telemetry can't break or stall a command.
 */
export async function finishTelemetry(error?: unknown): Promise<void> {
  if (!getClient()) {
    return
  }

  try {
    const failed = error !== undefined || (process.exitCode !== undefined && Number(process.exitCode) !== 0)

    metrics.count('cli.command', 1, { attributes: { outcome: failed ? 'error' : 'success' } })

    if (error !== undefined) {
      captureException(error)
    }

    await flush(FLUSH_TIMEOUT_MS)
  } catch {
    // Telemetry failures are never the user's problem
  }
}

/**
 * Rebuilds a crash event from an allowlist, so nothing user-controlled is sent. Error messages and
 * serialized extras can hold project paths, hostnames or credentials, so only the error type and
 * stack frames are kept, and each frame's path is cut down to the package file it points at.
 */
export function toCrashEvent(event: ErrorEvent): ErrorEvent {
  return {
    contexts: event.contexts?.trace ? { trace: event.contexts.trace } : undefined,
    environment: event.environment,
    event_id: event.event_id,
    exception: {
      values: event.exception?.values?.map(({ mechanism, stacktrace, type }) => ({
        mechanism,
        stacktrace: stacktrace?.frames ? { frames: stacktrace.frames.map(toCrashFrame) } : undefined,
        type,
      })),
    },
    level: event.level,
    platform: event.platform,
    release: event.release,
    sdk: event.sdk,
    tags: event.tags,
    timestamp: event.timestamp,
    type: event.type,
  }
}

function toCrashFrame({ colno, filename, function: functionName, in_app, lineno }: StackFrame): StackFrame {
  return { colno, filename: filename && toPackagePath(filename), function: functionName, in_app, lineno }
}

// `/Users/alice/.npm/_npx/abc/node_modules/solana-mobile/dist/cli.mjs` becomes `solana-mobile/dist/cli.mjs`.
// Built-ins such as `node:internal/...` are kept, and any other path keeps only its file name.
export function toPackagePath(filename: string): string {
  const path = filename.replaceAll('\\', '/')

  if (path.startsWith('node:')) {
    return path
  }

  const packageIndex = path.lastIndexOf('node_modules/')

  return packageIndex === -1 ? (path.split('/').pop() ?? '') : path.slice(packageIndex + 'node_modules/'.length)
}
