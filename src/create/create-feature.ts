import { Command, InvalidArgumentError, type Option } from 'commander'
import type { PackageManager } from 'create-solana-dapp'
import { type CreateCommandOptions, runCreate } from './create-feature-scaffold.ts'
import { MINIMAL_TEMPLATE_NAME } from './data-access/template-catalog.ts'

export type CreateCommandDeps = {
  runCreate?: (options: CreateCommandOptions) => Promise<void>
}

export function createCreateCommand({ runCreate: runCreateCommand = runCreate }: CreateCommandDeps = {}): Command {
  // Template options (e.g. `--reset-project`) are extracted from the raw arguments before
  // commander parses them: commander drops the `--` separator and reroutes operands once it hits
  // an unknown option, so the leftovers arrive too mangled to parse reliably.
  let templateOptions: string[] = []

  const createCommand = new Command('create')
    .argument('[projectName]')
    .description('Create a new Solana Mobile project')
    .option('--pm, --package-manager <packageManager>', 'Package manager to use', parsePackageManagerOption)
    .option('-d, --dry-run', 'Dry run')
    .option('-t, --template <templateName>', 'Use a template')
    .option('--list-template-ids', 'List available template ids as JSON array')
    .option('--list-templates', 'List available templates')
    .option('--list-versions', 'Verify your versions of Anchor, AVM, Rust, and Solana')
    .option('--minimal', 'Use the minimal template')
    .option('--skip-git', 'Skip git initialization')
    .option('--skip-init', 'Skip running the init script')
    .option('--skip-install', 'Skip installing dependencies')
    .option('-v, --verbose', 'Verbose output')
    .addHelpText(
      'after',
      '\nOptions declared by the selected template are passed through as boolean long flags, e.g.:\n  $ solana-mobile create my-app --minimal --reset-project',
    )
    .action(async (projectName: string | undefined, options: CreateCommandOptions) => {
      if (options.minimal && options.template) {
        createCommand.error(
          `error: The --minimal flag can't be used in combination with --template. Please specify only one.`,
        )
      }

      await runCreateCommand({
        ...options,
        projectName,
        template: options.template ?? (options.minimal ? MINIMAL_TEMPLATE_NAME : undefined),
        templateOptions,
      })
    })

  const parseCreateCommandOptions = createCommand.parseOptions.bind(createCommand)
  createCommand.parseOptions = (argv: string[]) => {
    try {
      const extracted = extractTemplateOptions(createCommand, argv)
      templateOptions = extracted.templateOptions
      return parseCreateCommandOptions(extracted.args)
    } catch (error) {
      return createCommand.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return createCommand
}

const templateOptionPattern = /^--([a-z][a-z0-9-]*)$/

/**
 * Extracts template-defined option flags such as `--reset-project` from the create command's raw
 * arguments before commander parses them, mirroring the extraction create-solana-dapp performs on
 * its own argv. Working on the raw arguments is what keeps `--` semantics intact — commander drops
 * the separator (or keeps it, depending on what precedes it) before leftovers are visible — and it
 * leaves commander's own unknown-option and excess-argument checks active for everything that
 * remains. create-solana-dapp validates the collected names against the options the cloned
 * template declares.
 */
export function extractTemplateOptions(
  command: Command,
  args: string[],
): { args: string[]; templateOptions: string[] } {
  const remaining: string[] = []
  const templateOptions = new Set<string>()
  let positionalOnly = false
  let preserveNextArgument = false

  for (const arg of args) {
    if (positionalOnly || preserveNextArgument) {
      remaining.push(arg)
      preserveNextArgument = false
      continue
    }

    if (arg === '--') {
      positionalOnly = true
      remaining.push(arg)
      continue
    }

    const knownOption = findKnownOption(command, arg)

    if (knownOption) {
      remaining.push(arg)
      preserveNextArgument = Boolean(knownOption.required) && !hasInlineValue(arg)
      continue
    }

    // The help option is registered outside `command.options`, so it needs its own pass-through
    if (!arg.startsWith('-') || arg === '-h' || arg === '--help') {
      remaining.push(arg)
      continue
    }

    const name = templateOptionPattern.exec(arg)?.[1]

    if (!name) {
      throw new InvalidArgumentError(
        `Template options must be boolean long flags such as --reset-project; received "${arg}".`,
      )
    }

    templateOptions.add(name)
  }

  return { args: remaining, templateOptions: [...templateOptions] }
}

function findKnownOption(command: Command, arg: string): Option | undefined {
  // Check both flags: a dual-flag option such as `--pm, --package-manager` stores `--pm` as `short`
  const flag = arg.startsWith('--') ? (arg.split('=', 1)[0] ?? arg) : arg.slice(0, 2)

  return command.options.find((option) => option.short === flag || option.long === flag)
}

// A value attached to the flag itself (`--pm=pnpm`, `-tvalue`) means the next argument is not its value
function hasInlineValue(arg: string): boolean {
  return arg.startsWith('--') ? arg.includes('=') : arg.length > 2
}

export function parsePackageManagerOption(next: string): PackageManager {
  if (!next || !isPackageManager(next)) {
    throw new InvalidArgumentError(`Invalid package manager: ${next}`)
  }

  return next
}

function isPackageManager(value: string): value is PackageManager {
  return value === 'bun' || value === 'npm' || value === 'pnpm' || value === 'yarn'
}
