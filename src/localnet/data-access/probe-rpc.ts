import type { JsonRpcFetcher, RpcProbeResult } from './localnet-types.ts'

export const defaultJsonRpcFetcher: JsonRpcFetcher = async (url, method) => {
  const response = await fetch(url, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

/**
 * Host-side leg of the check: a real JSON-RPC round trip proving the validator is alive. The device-side
 * leg cannot do this, because Android ships no HTTP client (see `probe-device-port.ts`).
 */
export async function probeRpc(
  url: string,
  { fetchJsonRpc = defaultJsonRpcFetcher }: { fetchJsonRpc?: JsonRpcFetcher } = {},
): Promise<RpcProbeResult> {
  try {
    const health = await fetchJsonRpc(url, 'getHealth')

    if (readResult(health) !== 'ok') {
      return { error: `Unexpected getHealth response: ${JSON.stringify(readResult(health))}`, ok: false }
    }

    return { ok: true, version: readVersion(await fetchJsonRpc(url, 'getVersion')) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false }
  }
}

function readResult(payload: unknown): unknown {
  return payload && typeof payload === 'object' ? (payload as { result?: unknown }).result : undefined
}

function readVersion(payload: unknown): string | undefined {
  const result = readResult(payload)

  if (!result || typeof result !== 'object') {
    return undefined
  }

  const { 'solana-core': solanaCore, 'surfnet-version': surfnetVersion } = result as Record<string, unknown>

  if (typeof surfnetVersion === 'string') {
    return `surfnet ${surfnetVersion}`
  }

  return typeof solanaCore === 'string' ? `solana-core ${solanaCore}` : undefined
}

export async function waitForRpc(
  url: string,
  {
    fetchJsonRpc = defaultJsonRpcFetcher,
    intervalMs = 1_000,
    onAttempt,
    timeoutMs = 120_000,
    wait = defaultWait,
  }: {
    fetchJsonRpc?: JsonRpcFetcher
    intervalMs?: number
    onAttempt?: (attempt: number) => Promise<void> | void
    timeoutMs?: number
    wait?: (ms: number) => Promise<void>
  } = {},
): Promise<RpcProbeResult> {
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  let last: RpcProbeResult = { error: 'Timed out before the first attempt', ok: false }

  while (Date.now() < deadline) {
    attempt += 1
    // Lets the caller abort early when the container has already exited.
    await onAttempt?.(attempt)
    last = await probeRpc(url, { fetchJsonRpc })

    if (last.ok) {
      return last
    }

    await wait(intervalMs)
  }

  return last
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
