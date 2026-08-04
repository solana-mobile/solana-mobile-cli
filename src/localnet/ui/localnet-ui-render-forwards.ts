import { log } from '@clack/prompts'
import type { AdbDevice, ForwardAction, LocalnetStatusReport } from '../data-access/localnet-types.ts'
import { DEVICES_HEADING, NO_DEVICES_MESSAGE, VALIDATOR_HEADING } from './localnet-ui-messages.ts'

/** Marks a re-sync during `--watch`, so a table appearing later has a visible reason. */
export function renderDevicesHeading() {
  log.step(DEVICES_HEADING)
}

export function renderForwards(actions: readonly ForwardAction[], devices: readonly AdbDevice[]) {
  if (devices.length === 0) {
    console.log(NO_DEVICES_MESSAGE)
    return
  }

  const unusable = devices.filter(({ state }) => state !== 'device')

  if (actions.length === 0 && unusable.length === 0) {
    console.log(NO_DEVICES_MESSAGE)
    return
  }

  if (actions.length > 0) {
    console.table(
      actions.map(({ devicePort, hostPort, kind, name, serial }) => ({
        action: kind,
        device: serial,
        'device port': devicePort,
        'host port': hostPort,
        port: name,
      })),
      ['device', 'port', 'device port', 'host port', 'action'],
    )
  }

  for (const { serial, state } of unusable) {
    console.log(`Skipped ${serial}: device state is "${state}".`)
  }
}

export function renderLocalnetStatus({ container, devices, engine, rpcUrl }: LocalnetStatusReport) {
  log.step(VALIDATOR_HEADING)
  console.table(
    [
      {
        detail: container.running
          ? `${container.status}${container.health ? ` (${container.health})` : ''}`
          : (container.status ?? 'not created'),
        item: `container ${container.name}`,
      },
      { detail: engine, item: 'engine' },
      { detail: rpcUrl, item: 'rpc url' },
    ],
    ['item', 'detail'],
  )

  log.step(DEVICES_HEADING)

  if (devices.length === 0) {
    console.log(NO_DEVICES_MESSAGE)
    return
  }

  console.table(
    devices.map(({ forwards, serial, state }) => ({
      device: serial,
      forwards: forwards.length
        ? forwards.map(({ devicePort, hostPort }) => `${devicePort}->${hostPort}`).join(' ')
        : '-',
      state,
    })),
    ['device', 'state', 'forwards'],
  )
}
