import { Command } from 'commander'
import { type DoctorCommandOptions, runDoctor } from './doctor-feature-check.ts'

export type DoctorCommandDeps = {
  runDoctor?: (options: DoctorCommandOptions) => Promise<number>
}

export function createDoctorCommand({ runDoctor: runDoctorCommand = runDoctor }: DoctorCommandDeps = {}): Command {
  return new Command('doctor')
    .description('Check local development dependencies')
    .option('--json', 'Print a stable JSON report')
    .option('--verbose', 'Include resolved paths and diagnostic details')
    .action(async (options: DoctorCommandOptions) => {
      process.exitCode = await runDoctorCommand(options)
    })
}
