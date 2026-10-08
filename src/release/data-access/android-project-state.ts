import { join } from 'node:path'
import type { CommandRunner } from '../../core/data-access/command-types.ts'
import type { AndroidProjectState } from './release-types.ts'

/**
 * An `android/` directory that git ignores is a continuous native generation project, rebuilt by
 * prebuild from the app config. Outside a git repository `git check-ignore` fails, which counts as
 * not ignored, so the directory is treated as a native project.
 */
export async function resolveAndroidProjectState(
  root: string,
  pathExists: (path: string) => Promise<boolean>,
  runCommand: CommandRunner,
): Promise<AndroidProjectState> {
  if (!(await pathExists(join(root, 'android')))) {
    return 'missing'
  }

  try {
    await runCommand(['git', '-C', root, 'check-ignore', '--quiet', 'android'])
    return 'generated'
  } catch {
    return 'native'
  }
}
