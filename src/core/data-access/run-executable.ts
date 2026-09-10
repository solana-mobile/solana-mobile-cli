import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import type { InteractiveCommandRunner, RunCommandOptions } from './command-types.ts'

const CMD_EXE_METACHARACTERS = /[&|<>^"%\r\n]/

/**
 * `.bat` and `.cmd` files are not programs: Windows can only run them through cmd.exe, and Node refuses to do that
 * implicitly since CVE-2024-27980. cmd.exe re-parses the whole command text, so the wrapping is only safe when no part
 * of the command carries its metacharacters. Anything else is returned untouched.
 */
export function resolveSpawnCommand(
  cmd: [string, ...string[]],
  platform: NodeJS.Platform = process.platform,
): [string, ...string[]] {
  if (platform !== 'win32' || !/\.(?:bat|cmd)$/i.test(cmd[0])) {
    return cmd
  }

  for (const part of cmd) {
    if (CMD_EXE_METACHARACTERS.test(part)) {
      throw new Error(`Cannot run ${basename(cmd[0])}: ${part} contains characters cmd.exe would interpret.`)
    }
  }

  return ['cmd.exe', '/c', ...cmd]
}

export const runInteractiveExecutable: InteractiveCommandRunner = async (cmd, options = {}) => {
  return new Promise((resolve, reject) => {
    const [file, ...args] = resolveSpawnCommand(cmd)
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`${basename(cmd[0])} exited with code ${exitCode}`))
        return
      }

      resolve()
    })
  })
}

export async function runExecutable(cmd: [string, ...string[]], options: RunCommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = resolveSpawnCommand(cmd)
    const child = spawn(file, args, {
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stderr: Buffer[] = []
    const stdout: Buffer[] = []

    child.stderr.on('data', (chunk) => {
      stderr.push(Buffer.from(chunk))
    })
    child.stdout.on('data', (chunk) => {
      stdout.push(Buffer.from(chunk))
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      const stderrText = Buffer.concat(stderr).toString()
      const stdoutText = Buffer.concat(stdout).toString()

      if (exitCode !== 0) {
        reject(new Error(stderrText.trim() || stdoutText.trim() || `${basename(cmd[0])} exited with code ${exitCode}`))
        return
      }

      // Concatenated rather than interleaved: the streams are captured separately, so their relative
      // order is not recoverable. Both are kept because either can carry the answer.
      resolve(options.combineOutput ? [stdoutText, stderrText].filter(Boolean).join('') : stdoutText)
    })

    child.stdin.end(options.stdin)
  })
}
