import { cancel, intro, outro } from '@clack/prompts'
import { runExecutable } from '../core/data-access/run-executable.ts'
import { collectExistingReverses } from './data-access/apply-forwards.ts'
import { inspectLocalnetContainer } from './data-access/docker-engine.ts'
import { listAdbDevices } from './data-access/list-adb-devices.ts'
import { localnetRpcUrl, resolveLocalnetForContainer } from './data-access/localnet-engines.ts'
import type {
  AdbDependencies,
  LocalnetStatusCommandOptions,
  LocalnetStatusReport,
} from './data-access/localnet-types.ts'
import { renderLocalnetStatus } from './ui/localnet-ui-render-forwards.ts'

export interface RunLocalnetStatusDependencies extends AdbDependencies {
  cancel?: (message: string) => void
  intro?: (message: string) => void
  outro?: (message: string) => void
}

export async function createLocalnetStatusReport(
  options: LocalnetStatusCommandOptions = {},
  { runCommand = runExecutable }: AdbDependencies = {},
): Promise<LocalnetStatusReport> {
  const container = await inspectLocalnetContainer({ runCommand })
  // The container knows which engine it is and which host ports it published, so `status` works without
  // repeating `--engine` or `--port`.
  const localnet = resolveLocalnetForContainer(container, options)
  const all = await listAdbDevices({ runCommand })
  const selected = options.devices?.length ? all.filter(({ serial }) => options.devices?.includes(serial)) : all
  const existing = await collectExistingReverses(selected, { runCommand })

  return {
    container,
    devices: selected.map(({ serial, state }) => ({
      forwards: (existing.get(serial) ?? []).filter(({ devicePort }) =>
        localnet.ports.some((port) => port.canonical === devicePort),
      ),
      serial,
      state,
    })),
    engine: localnet.engine.id,
    rpcUrl: localnetRpcUrl(localnet),
  }
}

export async function runLocalnetStatus(
  options: LocalnetStatusCommandOptions = {},
  {
    cancel: showCancel = cancel,
    intro: showIntro = intro,
    outro: showOutro = outro,
    runCommand = runExecutable,
  }: RunLocalnetStatusDependencies = {},
) {
  try {
    const report = await createLocalnetStatusReport(options, { runCommand })

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }

    showIntro('solana-mobile localnet status')
    renderLocalnetStatus(report)
    showOutro('Done')
  } catch (error) {
    showCancel(`${error}`)
    process.exitCode = 1
  }
}
