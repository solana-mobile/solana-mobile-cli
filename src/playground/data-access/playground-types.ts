import { z } from 'zod'

export type PlaygroundClusterId = 'devnet' | 'localnet' | 'mainnet' | 'testnet'

export interface PlaygroundCommandOptions {
  cluster?: PlaygroundClusterId
  device?: string
  open?: boolean
  port?: number
  url?: string
  verbose?: boolean
}

/** Everything the page needs to know, served as `GET /config.json`. */
export interface PlaygroundConfig {
  /** MWA chain identifier passed to `authorize`, e.g. `solana:devnet`. */
  chain: string
  cluster: PlaygroundClusterId
  /** RPC URL as seen from the device, so localnet points at the reversed canonical port. */
  rpcUrl: string
}

/**
 * One wallet interaction outcome, reported by the page as `POST /events`. The schema is the contract a
 * future headless mode would assert on, so additions are fine but renames are breaking.
 */
export const playgroundEventSchema = z.object({
  detail: z.string().max(2048).optional(),
  kind: z.enum(['airdrop', 'connect', 'sign-and-send', 'sign-in', 'sign-message', 'sign-transaction']),
  ok: z.boolean(),
})

export type PlaygroundEvent = z.infer<typeof playgroundEventSchema>

export type PlaygroundEventKind = PlaygroundEvent['kind']
