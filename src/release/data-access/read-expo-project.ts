import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import type { ExpoProject } from './release-types.ts'

const DYNAMIC_CONFIG_FILES = ['app.config.cjs', 'app.config.js', 'app.config.mjs', 'app.config.ts']

export interface ReadExpoProjectDependencies {
  findExpoCli?: (root: string) => Promise<string | undefined>
  runCommand?: CommandRunner
}

/**
 * Resolves the Expo app config of the project at `root`. When the project's own Expo CLI is installed
 * it runs `expo config`, which evaluates `app.config.*` the way prebuild does; otherwise `app.json` is
 * read directly, which is only possible when there is no dynamic config to evaluate.
 */
export async function readExpoProject(
  root: string,
  { findExpoCli = findInstalledExpoCli, runCommand = runExecutable }: ReadExpoProjectDependencies = {},
): Promise<ExpoProject> {
  const packageJson = await readJsonObject(join(root, 'package.json'))
  if (packageJson === undefined) {
    throw new Error(`No package.json found in ${root}.`)
  }

  if (!hasDependency(packageJson, 'expo')) {
    throw new Error(`${root} is not an Expo project: package.json does not depend on expo.`)
  }

  const expoCli = await findExpoCli(root)
  if (expoCli) {
    // The CLI prints the resolved config and nothing else with --json; `public` is the config an app
    // can read at runtime, which carries every field these checks look at.
    const output = await runCommand(['node', expoCli, 'config', root, '--json', '--type', 'public'])
    return { config: parseConfigOutput(output), configSource: 'expo config', root }
  }

  const dynamicConfig = await findFirst(root, DYNAMIC_CONFIG_FILES)
  if (dynamicConfig) {
    throw new Error(
      `${dynamicConfig} can only be evaluated by the project's Expo CLI, which is not installed. Install the project's dependencies and run again.`,
    )
  }

  const appJson = await readJsonObject(join(root, 'app.json'))
  if (appJson === undefined) {
    throw new Error(`No app.json or app.config.* found in ${root}.`)
  }

  const expo = appJson.expo
  return { config: isRecord(expo) ? expo : appJson, configSource: 'app.json', root }
}

/** Walks up from `root` the way Node resolves packages, so a CLI hoisted to a monorepo root is found. */
export async function findInstalledExpoCli(root: string): Promise<string | undefined> {
  for (let directory = root; ; directory = dirname(directory)) {
    const cli = join(directory, 'node_modules', 'expo', 'bin', 'cli')
    if (await exists(cli)) {
      return cli
    }

    if (dirname(directory) === directory) {
      return undefined
    }
  }
}

function parseConfigOutput(output: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(`expo config did not print JSON: ${output.trim().slice(0, 200)}`)
  }

  if (!isRecord(parsed)) {
    throw new Error('expo config did not print a JSON object.')
  }

  return parsed
}

function hasDependency(packageJson: Record<string, unknown>, name: string) {
  return ['dependencies', 'devDependencies'].some((field) => {
    const dependencies = packageJson[field]
    return isRecord(dependencies) && name in dependencies
  })
}

async function findFirst(root: string, names: string[]) {
  for (const name of names) {
    if (await exists(join(root, name))) {
      return name
    }
  }

  return undefined
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`${path} does not contain a JSON object.`)
  }

  return parsed
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
