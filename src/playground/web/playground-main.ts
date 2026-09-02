import {
  type Address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'
import type { Chain } from '@solana-mobile/mobile-wallet-adapter-protocol'
import { type KitMobileWallet, transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import { getTransferSolInstruction } from '@solana-program/system'
import type { PlaygroundConfig, PlaygroundEvent, PlaygroundEventKind } from '../data-access/playground-types.ts'

const AUTH_TOKEN_KEY = 'solana-mobile-playground:auth-token'

const APP_IDENTITY = { name: 'Solana Mobile Playground', uri: location.origin }

interface ConnectedAccount {
  address: Address
  addressBase64: string
}

async function main(): Promise<void> {
  const app = document.getElementById('app')

  if (!app) {
    throw new Error('Missing #app element')
  }

  const config: PlaygroundConfig = await (await fetch('/config.json')).json()
  const rpc = createSolanaRpc(config.rpcUrl)

  let account: ConnectedAccount | undefined

  // --- layout -----------------------------------------------------------------------------------

  const header = el('header')
  header.append(el('h1', undefined, 'Solana Mobile Playground'))

  const meta = el('p', 'meta')
  meta.append(el('span', `badge badge-${config.cluster}`, config.cluster), el('span', 'rpc', config.rpcUrl))
  header.append(meta)

  const accountSection = el('section', 'account hidden')
  const addressLine = el('p', 'address')
  const balanceLine = el('p', 'balance', '—')
  const fundingLine = el('p', 'funding')
  accountSection.append(addressLine, balanceLine, fundingLine)

  const actions = el('section', 'actions')
  const logList = el('ul', 'log')

  app.append(header)

  if (config.cluster === 'mainnet') {
    app.append(el('p', 'warning', 'Mainnet: transactions here cost real SOL.'))
  }

  app.append(accountSection, actions, el('h2', undefined, 'Results'), logList)

  // --- helpers ----------------------------------------------------------------------------------

  function appendLog(status: 'error' | 'info' | 'ok', label: string, detail?: string, link?: string): void {
    const item = el('li', `entry entry-${status}`)
    item.append(el('span', 'entry-label', label))

    if (detail) {
      item.append(el('span', 'entry-detail', detail))
    }

    if (link) {
      const anchor = el('a', 'entry-link', 'View in Explorer')
      anchor.href = link
      anchor.rel = 'noreferrer'
      anchor.target = '_blank'
      item.append(anchor)
    }

    logList.prepend(item)
  }

  function report(event: PlaygroundEvent, link?: string): void {
    appendLog(event.ok ? 'ok' : 'error', EVENT_LABELS[event.kind], event.detail, link)
    fetch('/events', {
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).catch(() => {})
  }

  function setBusy(busy: boolean): void {
    // Includes the localnet airdrop button in `fundingLine`, so it is disabled during any interaction
    // (and while its own request is in flight), not just the buttons in the actions section.
    const controls = [...actions.querySelectorAll('button'), ...fundingLine.querySelectorAll('button')]

    for (const control of controls) {
      control.disabled = busy
    }
  }

  async function runAction(kind: PlaygroundEventKind, action: () => Promise<{ detail?: string; link?: string }>) {
    setBusy(true)

    try {
      const { detail, link } = await action()
      report({ detail, kind, ok: true }, link)
    } catch (error) {
      report({ detail: describeError(error), kind, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Safety net for the wallet round-trip. `transact()` navigates the tab to the wallet, and when the
  // user cancels — declining, or dismissing the wallet chooser — the in-flight promise can be left
  // unsettled (Android Chrome may also freeze/restore the page across the jump), so runAction's
  // `finally` never runs and the buttons stay disabled forever. Being back on this page means the
  // interaction is over either way, so re-enable on every signal that we have returned: `focus` covers
  // dismissing the chooser overlay (the page never goes hidden, only loses focus), while
  // `visibilitychange`/`pageshow` cover switching back from the full-screen wallet app.
  const reenableOnReturn = () => setBusy(false)
  window.addEventListener('focus', reenableOnReturn)
  window.addEventListener('pageshow', reenableOnReturn)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reenableOnReturn()
    }
  })

  /** Authorizes inside an open session, reusing the cached token so repeat runs skip the approval UI. */
  async function authorizeWallet(wallet: KitMobileWallet): Promise<ConnectedAccount> {
    const auth = await wallet.authorize({
      auth_token: localStorage.getItem(AUTH_TOKEN_KEY) ?? undefined,
      chain: config.chain as Chain,
      identity: APP_IDENTITY,
    })

    return applyAuthorization(auth)
  }

  function applyAuthorization(auth: {
    accounts: readonly { address: string }[]
    auth_token: string
  }): ConnectedAccount {
    const first = auth.accounts[0]

    if (!first) {
      throw new Error('The wallet returned no accounts')
    }

    localStorage.setItem(AUTH_TOKEN_KEY, auth.auth_token)

    // MWA returns base64-encoded public keys; kit wants base58 addresses.
    const address = getAddressDecoder().decode(getBase64Encoder().encode(first.address))

    account = { address, addressBase64: first.address }
    renderAccount(account)

    return account
  }

  function renderAccount(connected: ConnectedAccount): void {
    accountSection.classList.remove('hidden')
    addressLine.textContent = connected.address
    fundingLine.replaceChildren()

    if (config.cluster === 'devnet' || config.cluster === 'testnet') {
      const faucet = el('a', undefined, 'Request SOL from the faucet')
      faucet.href = `https://faucet.solana.com/?cluster=${config.cluster}&walletAddress=${connected.address}`
      faucet.rel = 'noreferrer'
      faucet.target = '_blank'
      fundingLine.append(faucet)
    }

    if (config.cluster === 'localnet') {
      fundingLine.append(
        button('Airdrop 1 SOL', () =>
          runAction('airdrop', async () => {
            await rpc.requestAirdrop(connected.address, lamports(1_000_000_000n)).send()
            await refreshBalance()

            return { detail: `1 SOL to ${abbreviate(connected.address)}` }
          }),
        ),
      )
    }

    void refreshBalance()
  }

  async function refreshBalance(): Promise<void> {
    if (!account) {
      return
    }

    try {
      const { value } = await rpc.getBalance(account.address).send()
      balanceLine.textContent = `${(Number(value) / 1_000_000_000).toFixed(4)} SOL`
    } catch (error) {
      balanceLine.textContent = `Balance unavailable — ${describeError(error)}`
    }
  }

  /** Built inside the wallet session so the RPC round trip happens after the user gesture is spent. */
  async function buildSelfTransfer(owner: Address): Promise<Transaction> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(owner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            amount: lamports(0n),
            destination: owner,
            source: createNoopSigner(owner),
          }),
          m,
        ),
    )

    return compileTransaction(message)
  }

  function explorerUrl(signature: string): string {
    if (config.cluster === 'mainnet') {
      return `https://explorer.solana.com/tx/${signature}`
    }

    if (config.cluster === 'localnet') {
      return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}`
    }

    return `https://explorer.solana.com/tx/${signature}?cluster=${config.cluster}`
  }

  // --- actions ----------------------------------------------------------------------------------

  actions.append(
    button('Connect', () =>
      runAction('connect', async () => {
        const connected = await transact((wallet) => authorizeWallet(wallet))

        return { detail: abbreviate(connected.address) }
      }),
    ),
    button('Sign In (SIWS)', () =>
      runAction('sign-in', async () => {
        const auth = await transact((wallet) =>
          wallet.authorize({
            auth_token: localStorage.getItem(AUTH_TOKEN_KEY) ?? undefined,
            chain: config.chain as Chain,
            identity: APP_IDENTITY,
            sign_in_payload: {
              domain: location.host,
              statement: 'Sign in to the Solana Mobile Playground',
              uri: location.origin,
            },
          }),
        )

        applyAuthorization(auth)

        if (!auth.sign_in_result) {
          throw new Error('The wallet returned no sign-in result')
        }

        return { detail: `signature ${shorten(auth.sign_in_result.signature)}` }
      }),
    ),
    button('Sign Message', () =>
      runAction('sign-message', async () => {
        const signed = await transact(async (wallet) => {
          const connected = await authorizeWallet(wallet)

          return wallet.signMessages({
            addresses: [connected.addressBase64],
            payloads: [new TextEncoder().encode(`Solana Mobile Playground — ${new Date().toISOString()}`)],
          })
        })

        const payload = signed[0]

        if (!payload) {
          throw new Error('The wallet returned no signed payload')
        }

        return {
          detail: payload.length === 64 ? getBase58Decoder().decode(payload) : `${payload.length}-byte signed payload`,
        }
      }),
    ),
    button('Sign Transaction', () =>
      runAction('sign-transaction', async () => {
        const signed = await transact(async (wallet) => {
          const connected = await authorizeWallet(wallet)
          const transaction = await buildSelfTransfer(connected.address)
          const [result] = await wallet.signTransactions({ transactions: [transaction] })

          return result
        })

        if (!signed || !account) {
          throw new Error('The wallet returned no signed transaction')
        }

        const signature = signed.signatures[account.address]

        return { detail: signature ? getBase58Decoder().decode(signature) : 'signed (no signature returned)' }
      }),
    ),
    button('Sign and Send', () =>
      runAction('sign-and-send', async () => {
        let signature: string

        if (config.cluster === 'localnet') {
          // The wallet's own send path submits to the wallet's RPC, which cannot see localnet — so the
          // wallet signs and the page submits through the localnet RPC instead.
          const signed = await transact(async (wallet) => {
            const connected = await authorizeWallet(wallet)
            const transaction = await buildSelfTransfer(connected.address)
            const [result] = await wallet.signTransactions({ transactions: [transaction] })

            return result
          })

          if (!signed) {
            throw new Error('The wallet returned no signed transaction')
          }

          signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64' }).send()
        } else {
          const signatures = await transact(async (wallet) => {
            const connected = await authorizeWallet(wallet)
            const transaction = await buildSelfTransfer(connected.address)

            return wallet.signAndSendTransactions({ transactions: [transaction] })
          })

          const signatureBytes = signatures[0]

          if (!signatureBytes) {
            throw new Error('The wallet returned no signature')
          }

          signature = getBase58Decoder().decode(signatureBytes)
        }

        void refreshBalance()

        return { detail: shorten(signature), link: explorerUrl(signature) }
      }),
    ),
  )

  const reset = el('button', 'reset', 'Reset authorization')
  reset.addEventListener('click', () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    account = undefined
    accountSection.classList.add('hidden')
    appendLog('info', 'Reset', 'Cleared the cached authorization')
  })
  actions.append(reset)
}

const EVENT_LABELS: Record<PlaygroundEventKind, string> = {
  airdrop: 'Airdrop',
  connect: 'Connect',
  'sign-and-send': 'Sign and Send',
  'sign-in': 'Sign In',
  'sign-message': 'Sign Message',
  'sign-transaction': 'Sign Transaction',
}

function abbreviate(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value
}

function shorten(value: string): string {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value
}

function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', undefined, label)
  element.type = 'button'
  element.addEventListener('click', onClick)

  return element
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)

  if (className) {
    element.className = className
  }

  if (text !== undefined) {
    element.textContent = text
  }

  return element
}

main().catch((error) => {
  document.body.append(el('p', 'warning', `Failed to start: ${describeError(error)}`))
})
