import { Command } from 'commander'
import { runTelemetry, type TelemetryAction } from './telemetry-feature-index.ts'

export type TelemetryCommandDeps = {
  runTelemetry?: (action: TelemetryAction) => Promise<void>
}

export function createTelemetryCommand({
  runTelemetry: runTelemetryCommand = runTelemetry,
}: TelemetryCommandDeps = {}): Command {
  const telemetryCommand = new Command('telemetry').description('Manage anonymous usage data')

  telemetryCommand.action(() => {
    telemetryCommand.outputHelp()
  })

  for (const [action, description] of [
    ['disable', 'Stop sending anonymous usage data'],
    ['enable', 'Send anonymous usage data'],
    ['status', 'Show whether anonymous usage data is sent'],
  ] as const) {
    telemetryCommand
      .command(action)
      .description(description)
      .action(async () => {
        await runTelemetryCommand(action)
      })
  }

  return telemetryCommand
}
