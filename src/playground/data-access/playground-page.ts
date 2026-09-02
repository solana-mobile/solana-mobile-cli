import { PLAYGROUND_PAGE } from '../web/playground-page.generated.ts'

/**
 * The page is authored as TypeScript + CSS under `web/` and bundled by `bun run build:playground` into
 * `playground-page.generated.ts`, which exports the finished HTML document as a string. Importing that
 * constant inlines the whole page into the compiled CLI bundle, so there is no separate asset to ship or
 * read from disk at runtime.
 */
export function loadPlaygroundPage(): string {
  return PLAYGROUND_PAGE
}
