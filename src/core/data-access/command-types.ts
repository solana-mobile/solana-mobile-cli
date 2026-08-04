export type CommandRunner = (cmd: [string, ...string[]], options?: RunCommandOptions) => Promise<string>

export type InteractiveCommandRunner = (cmd: [string, ...string[]]) => Promise<void>

export interface RunCommandOptions {
  /**
   * Return stderr alongside stdout. Needed for commands that report meaningful output on both streams —
   * `docker logs` forwards a container's stdout and stderr separately, so returning only stdout silently
   * drops half the diagnostics.
   */
  combineOutput?: boolean
  stdin?: string
}
