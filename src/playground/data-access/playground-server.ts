import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { type PlaygroundConfig, type PlaygroundEvent, playgroundEventSchema } from './playground-types.ts'

/** How far past the preferred port to look before giving up. Only used when the port was not forced. */
const PORT_ATTEMPTS = 10

/** Events are one-line results; anything bigger than this is not one of ours. */
const MAX_EVENT_BODY_BYTES = 64 * 1024

export interface StartPlaygroundServerOptions {
  config: PlaygroundConfig
  onEvent: (event: PlaygroundEvent) => void
  /** Fired when the page fetches its config, which doubles as proof the device can reach the server. */
  onPageLoad?: () => void
  page: string
  port: number
  /** With an explicit `--port` a busy port is an error; by default the server shifts to a free one. */
  strictPort?: boolean
}

export interface PlaygroundServer {
  close: () => Promise<void>
  port: number
}

export async function startPlaygroundServer({
  config,
  onEvent,
  onPageLoad,
  page,
  port,
  strictPort = false,
}: StartPlaygroundServerOptions): Promise<PlaygroundServer> {
  const server = createServer((request, response) => {
    handleRequest(request, response, { config, onEvent, onPageLoad, page }).catch(() => {
      respond(response, 500, 'text/plain', 'Internal error')
    })
  })

  const boundPort = await listenOnAvailablePort(server, port, strictPort ? 1 : PORT_ATTEMPTS)

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        // Keep-alive connections from the device browser would otherwise hold the process open. This
        // runs after close(): under Bun it also stops the server, which would make close() throw.
        server.closeAllConnections()
      }),
    port: boundPort,
  }
}

async function listenOnAvailablePort(server: Server, preferred: number, attempts: number): Promise<number> {
  for (let candidate = preferred; candidate < preferred + attempts; candidate++) {
    if (await tryListen(server, candidate)) {
      const bound = server.address()

      // `port: 0` asks the OS for a free port, so the answer comes from the bound address.
      return typeof bound === 'object' && bound !== null ? bound.port : candidate
    }
  }

  throw new Error(
    attempts === 1
      ? `Port ${preferred} is already in use`
      : `No free port between ${preferred} and ${preferred + attempts - 1}`,
  )
}

function tryListen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false)
        return
      }

      reject(error)
    }

    server.once('error', onError)
    // Loopback only: the device reaches it through `adb reverse`, nothing else should.
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve(true)
    })
  })
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  {
    config,
    onEvent,
    onPageLoad,
    page,
  }: Pick<StartPlaygroundServerOptions, 'config' | 'onEvent' | 'onPageLoad' | 'page'>,
): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname

  if (request.method === 'GET' && path === '/') {
    respond(response, 200, 'text/html; charset=utf-8', page)
    return
  }

  if (request.method === 'GET' && path === '/config.json') {
    onPageLoad?.()
    respond(response, 200, 'application/json', JSON.stringify(config))
    return
  }

  if (request.method === 'POST' && path === '/events') {
    const body = await readBody(request)
    const event = body === undefined ? undefined : parseEvent(body)

    if (event === undefined) {
      respond(response, 400, 'text/plain', 'Expected a playground event')
      return
    }

    onEvent(event)
    response.writeHead(204).end()
    return
  }

  respond(response, 404, 'text/plain', 'Not found')
}

function parseEvent(body: string): PlaygroundEvent | undefined {
  try {
    const parsed = playgroundEventSchema.safeParse(JSON.parse(body))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Resolves `undefined` for an over-limit body instead of throwing, so the caller can answer 400. */
function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > MAX_EVENT_BODY_BYTES) {
        request.removeAllListeners('data')
        request.removeAllListeners('end')
        resolve(undefined)
        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString()))
    request.on('error', reject)
  })
}

function respond(response: ServerResponse, status: number, contentType: string, body: string): void {
  if (response.headersSent) {
    response.end()
    return
  }

  response.writeHead(status, { 'Content-Type': contentType }).end(body)
}
