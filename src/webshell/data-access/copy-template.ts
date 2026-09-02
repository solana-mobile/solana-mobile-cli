import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CopyWebshellTemplateOptions {
  force?: boolean
}

/**
 * Copies the vendored Android template into a project directory. The template ships its root ignore
 * file un-dotted (npm strips dotted ones from tarballs), so the copy renames it to `.gitignore`. The
 * nested `app/.gitignore` is recreated unconditionally for the same reason — npm removes nested
 * .gitignore files from published tarballs, so it may be missing from the template at runtime.
 */
export async function copyWebshellTemplate(
  templateDirectory: string,
  targetDirectory: string,
  { force = false }: CopyWebshellTemplateOptions = {},
): Promise<void> {
  if (!force && !(await isDirectoryEmpty(targetDirectory))) {
    throw new Error(`Target directory ${targetDirectory} is not empty. Use --force to overwrite it.`)
  }

  await mkdir(targetDirectory, { recursive: true })

  for (const entry of await readdir(templateDirectory)) {
    const destination = join(targetDirectory, entry === 'gitignore' ? '.gitignore' : entry)
    if (force) {
      await rm(destination, { force: true, recursive: true })
    }
    await cp(join(templateDirectory, entry), destination, { errorOnExist: !force, force, recursive: true })
  }

  await mkdir(join(targetDirectory, 'app'), { recursive: true })
  await writeFile(join(targetDirectory, 'app', '.gitignore'), '/build\n', 'utf8')
  await ensureFileExecutable(join(targetDirectory, 'gradlew'))
}

async function ensureFileExecutable(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  const fileStats = await stat(filePath)
  const executableMode = fileStats.mode | 0o111
  if (fileStats.mode !== executableMode) {
    await chmod(filePath, executableMode)
  }
}

async function isDirectoryEmpty(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length === 0
  } catch {
    return true
  }
}
