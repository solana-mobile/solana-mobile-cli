import { log } from '@clack/prompts'
import type { LocalnetCheckReport } from '../data-access/localnet-types.ts'
import {
  CLEARTEXT_HINT_MESSAGE,
  DEVICES_HEADING,
  MISSING_FORWARDS_HINT_MESSAGE,
  NO_DEVICES_MESSAGE,
  RPC_UNREACHABLE_HINT_MESSAGE,
  VALIDATOR_HEADING,
} from './localnet-ui-messages.ts'

export function renderLocalnetCheck(report: LocalnetCheckReport) {
  // The two legs are separate sections, so a failure reads as belonging to one or the other.
  log.step(VALIDATOR_HEADING)
  console.table(
    [
      {
        detail: report.rpc.ok ? (report.rpc.version ?? 'reachable') : (report.rpc.error ?? 'unreachable'),
        result: report.rpc.ok ? 'pass' : 'fail',
        step: `host rpc ${report.rpcUrl}`,
      },
    ],
    ['step', 'result', 'detail'],
  )

  log.step(DEVICES_HEADING)

  if (report.devices.length === 0) {
    console.log(NO_DEVICES_MESSAGE)
    return
  }

  console.table(
    report.devices.flatMap(({ ports, serial, state }) =>
      ports.length === 0
        ? [{ detail: `device state is "${state}"`, device: serial, port: '-', result: 'skip' }]
        : ports.map(({ devicePort, name, ok, reason }) => ({
            detail: ok ? 'reverse registered on device' : (reason ?? 'no reverse on device'),
            device: serial,
            port: `${name} ${devicePort}`,
            result: ok ? 'pass' : 'fail',
          })),
    ),
    ['device', 'port', 'result', 'detail'],
  )

  console.log('')

  // Point at the leg that actually failed rather than blaming cleartext for a validator that is simply
  // not running.
  if (!report.rpc.ok) {
    console.log(RPC_UNREACHABLE_HINT_MESSAGE)
    return
  }

  if (!report.ok) {
    console.log(MISSING_FORWARDS_HINT_MESSAGE)
    return
  }

  console.log(CLEARTEXT_HINT_MESSAGE)
}
