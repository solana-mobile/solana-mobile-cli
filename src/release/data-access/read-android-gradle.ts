import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AndroidGradleConfig, AndroidReleaseSigning } from './release-types.ts'

const APP_BUILD_FILES = ['build.gradle', 'build.gradle.kts']

/** Reads the app module's Gradle file under `androidDirectory`; `undefined` when there is none. */
export async function readAndroidGradle(androidDirectory: string): Promise<AndroidGradleConfig | undefined> {
  for (const name of APP_BUILD_FILES) {
    const path = join(androidDirectory, 'app', name)
    if (await exists(path)) {
      return { ...parseAndroidGradle(await readFile(path, 'utf8')), path }
    }
  }

  return undefined
}

/**
 * Pulls the release-relevant values out of a Groovy or Kotlin DSL app module. This is a text scan,
 * not a Gradle evaluation: a value set through a variable, a property or a function call is left
 * undefined so the caller can say it could not be compared rather than guess.
 */
export function parseAndroidGradle(source: string): Omit<AndroidGradleConfig, 'path'> {
  const text = stripComments(source)

  return {
    applicationId: parseStringLiteral(text, 'applicationId'),
    releaseSigning: parseReleaseSigning(text),
    versionCode: parseVersionCode(text),
    versionName: parseStringLiteral(text, 'versionName'),
  }
}

/**
 * Reads `field "value"` or `field = "value"` only when the whole right-hand side is one string literal.
 * A double-quoted Groovy or Kotlin string containing `$` is interpolated, and anything after the closing
 * quote is an expression, so both are left undefined.
 */
function parseStringLiteral(text: string, field: string): string | undefined {
  const value = text.match(new RegExp(`\\b${field}\\b\\s*=?\\s*(.+?)\\s*$`, 'm'))?.[1]
  const literal = value?.match(/^(["'])([^"'\\]+)\1$/)
  if (!literal || (literal[1] === '"' && literal[2]?.includes('$'))) {
    return undefined
  }

  return literal[2]
}

function parseVersionCode(text: string): number | undefined {
  const value = text.match(/\bversionCode\s*=?\s*(\d+)\s*$/m)?.[1]
  return value === undefined ? undefined : Number(value)
}

function parseReleaseSigning(text: string): AndroidReleaseSigning {
  const buildTypes = findBlock(text, /\bbuildTypes\s*\{/)
  const release =
    buildTypes && findBlock(buildTypes, /(?:\brelease\b|(?:getByName|named)\(\s*["']release["']\s*\))\s*\{/)
  if (release === undefined) {
    return 'unsigned'
  }

  if (!/\bsigningConfig\b/.test(release)) {
    return 'unsigned'
  }

  // The property alternative must not be followed by `(`, or it would take the name of a lookup such as
  // `getByName(signingKey)` for the signing config itself.
  const name = release.match(
    /\bsigningConfig\s*=?\s*signingConfigs\.(?:getByName\(\s*["'](\w+)["']\s*\)|(\w+)\b(?!\s*\())/,
  )
  if (!name) {
    return 'unknown'
  }

  return (name[1] ?? name[2]) === 'debug' ? 'debug' : 'custom'
}

/** Returns the body of the first `{ … }` block whose opening matches `opening`, braces balanced. */
function findBlock(text: string, opening: RegExp): string | undefined {
  const match = opening.exec(text)
  if (!match) {
    return undefined
  }

  const start = match.index + match[0].length
  let depth = 1
  for (let index = start; index < text.length; index++) {
    if (text[index] === '{') depth++
    if (text[index] === '}' && --depth === 0) return text.slice(start, index)
  }

  return undefined
}

// A `//` only starts a comment at the beginning of a line or after whitespace, which keeps URLs such as
// `https://…` inside strings intact.
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
