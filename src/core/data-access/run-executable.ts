import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import type { InteractiveCommandRunner, RunCommandOptions } from './command-types.ts'

export const runInteractiveExecutable: InteractiveCommandRunner = async (cmd, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
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
    const child = spawn(cmd[0], cmd.slice(1), {
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
