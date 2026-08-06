import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { runExecutable } from '../../core/data-access/run-executable.ts'
import { type TemplateGroupConfig, TemplateRepositoryPackageJsonSchema } from './template-repository-schema.ts'

export type TemplateSyncActionKind = 'add' | 'remove' | 'unchanged' | 'update'

export interface TemplateSyncAction {
  action: TemplateSyncActionKind
  /** Tracked files to copy. Empty for `remove` and `unchanged`. */
  files: TrackedFile[]
  /** Repository-relative posix paths that are gitignored in the target and must survive the sync. */
  ignored: string[]
  /** Repository-relative posix path of the template, e.g. `mobile/expo-kit-minimal`. */
  path: string
}

export interface TemplateSyncPlan {
  actions: TemplateSyncAction[]
  groups: string[]
}

export interface TemplateSyncDependencies {
  listIgnoredFiles?: (root: string, path: string) => Promise<string[]>
  listTrackedFiles?: (root: string, path: string) => Promise<TrackedFile[]>
}

export interface TrackedFile {
  executable: boolean
  /** Repository-relative posix path. */
  path: string
  symlink: boolean
}

const executableMode = 0o755
const regularMode = 0o644

/**
 * Mirrors every synced group of the plan into the target repository.
 *
 * Added and updated templates are pruned in the target before their tracked files are copied, so files that were
 * deleted upstream never linger in the target — but files that are gitignored in the target (local env files,
 * installed dependencies) are preserved, because git cannot restore them and the working-tree check does not see
 * them. Only `git ls-files` output ever crosses over — anything gitignored in the source stays behind. Symlinks are
 * recreated as symlinks rather than dereferenced, because a tracked link may point at a gitignored file whose
 * contents must not be copied.
 *
 * Returns the paths of removed templates whose directory was kept because it still contains ignored files.
 */
export function applyTemplateSync(source: string, target: string, plan: TemplateSyncPlan): string[] {
  const kept: string[] = []

  for (const action of plan.actions) {
    if (action.action === 'unchanged') {
      continue
    }

    const fullyRemoved = pruneUnit(target, action.path, new Set(action.ignored))

    if (action.action === 'remove') {
      if (!fullyRemoved) {
        kept.push(action.path)
      }
      continue
    }

    for (const file of action.files) {
      const sourcePath = join(source, file.path)
      const targetPath = join(target, file.path)

      mkdirSync(dirname(targetPath), { recursive: true })

      if (file.symlink) {
        rmSync(targetPath, { force: true, recursive: true })
        symlinkSync(readlinkSync(sourcePath), targetPath)
        continue
      }

      writeFileSync(targetPath, readFileSync(sourcePath))
      // git only tracks the executable bit, so the conventional modes are applied explicitly instead of
      // inheriting the source filesystem's permissions or the process umask.
      chmodSync(targetPath, file.executable ? executableMode : regularMode)
    }
  }

  return kept
}

/** Lists uncommitted changes (staged, unstaged, and untracked) under the given paths of a git working tree. */
export async function listWorkTreeChanges(root: string, paths: string[]): Promise<string[]> {
  const output = await runExecutable(['git', '-C', root, 'status', '--porcelain', '-z', '--', ...paths])

  return output.split('\0').filter(Boolean)
}

/**
 * Plans a sync of every source group into the target repository without writing anything.
 *
 * Groups are matched by `path` — the group's `name` and `description` may legitimately differ per repository. Groups
 * that only exist in the target are left untouched, so a target repository can host groups the source does not know
 * about. Within a synced group the source is authoritative: templates missing from the source are planned for removal,
 * which is what turns an upstream rename into a clean delete-and-add instead of a stale duplicate.
 */
export async function planTemplateSync(
  source: string,
  target: string,
  { listIgnoredFiles = listGitIgnoredFiles, listTrackedFiles = listGitTrackedFiles }: TemplateSyncDependencies = {},
): Promise<TemplateSyncPlan> {
  if (source === target) {
    throw new Error('Source and target repositories are the same directory')
  }

  const sourceGroups = readRepositoryGroups(source, 'Source')
  const targetGroups = readRepositoryGroups(target, 'Target')
  const actions: TemplateSyncAction[] = []
  const groups: string[] = []

  for (const group of sourceGroups) {
    if (!targetGroups.some((targetGroup) => targetGroup.path === group.path)) {
      throw new Error(`Target repository does not declare a group with path "${group.path}"`)
    }

    const sourceUnits = groupByUnit(group.path, await listTrackedFiles(source, group.path))

    if (sourceUnits.size === 0) {
      throw new Error(`Source repository has no tracked files under "${group.path}"`)
    }

    const targetTracked = new Set((await listTrackedFiles(target, group.path)).map((file) => file.path))

    for (const [unit, files] of sourceUnits) {
      const { action } = planUnit(source, target, unit, files, targetTracked)
      const ignored = action === 'update' ? await listIgnoredFiles(target, unit) : []

      actions.push({ action, files, ignored, path: unit })
    }

    for (const entry of listDirectoryEntries(join(target, group.path))) {
      const unit = posix.join(group.path, entry)

      if (!sourceUnits.has(unit)) {
        actions.push({ action: 'remove', files: [], ignored: await listIgnoredFiles(target, unit), path: unit })
      }
    }

    groups.push(group.path)
  }

  actions.sort((left, right) => left.path.localeCompare(right.path))

  return { actions, groups }
}

/** Compares one tracked source file against the target working tree without following symlinks. */
function fileUnchanged(source: string, target: string, file: TrackedFile): boolean {
  const targetPath = join(target, file.path)
  const stats = lstatSync(targetPath, { throwIfNoEntry: false })

  if (!stats) {
    return false
  }

  if (file.symlink) {
    return stats.isSymbolicLink() && readlinkSync(join(source, file.path)) === readlinkSync(targetPath)
  }

  if (stats.isSymbolicLink() || !stats.isFile() || file.executable !== ((stats.mode & 0o100) !== 0)) {
    return false
  }

  return readFileSync(join(source, file.path)).equals(readFileSync(targetPath))
}

/** Groups tracked files by their first path segment below the group, so each template syncs as one unit. */
function groupByUnit(groupPath: string, files: TrackedFile[]): Map<string, TrackedFile[]> {
  const units = new Map<string, TrackedFile[]>()

  for (const file of files) {
    const [firstSegment = ''] = posix.relative(groupPath, file.path).split('/')
    const unit = posix.join(groupPath, firstSegment)
    const unitFiles = units.get(unit) ?? []

    unitFiles.push(file)
    units.set(unit, unitFiles)
  }

  return units
}

function listDirectoryEntries(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { encoding: 'utf8' }).sort((left, right) => left.localeCompare(right))
}

/**
 * Lists gitignored paths under a directory. Directories whose entire contents are ignored (like `node_modules`) come
 * back as one entry with a trailing slash, which is stripped so the paths compare against plain walk output.
 */
async function listGitIgnoredFiles(root: string, path: string): Promise<string[]> {
  const output = await runExecutable([
    'git',
    '-C',
    root,
    'ls-files',
    '-z',
    '--directory',
    '--exclude-standard',
    '--ignored',
    '--others',
    '--',
    path,
  ])

  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ''))
}

async function listGitTrackedFiles(root: string, path: string): Promise<TrackedFile[]> {
  const output = await runExecutable(['git', '-C', root, 'ls-files', '-s', '-z', '--', path])

  return output
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [info = '', filePath = ''] = line.split('\t')
      const [mode = ''] = info.split(' ')

      if (mode === '160000') {
        throw new Error(`${filePath}: git submodules cannot be synced`)
      }

      return { executable: mode === '100755', path: filePath, symlink: mode === '120000' }
    })
}

function planUnit(
  source: string,
  target: string,
  unit: string,
  files: TrackedFile[],
  targetTracked: Set<string>,
): { action: TemplateSyncActionKind } {
  if (!lstatSync(join(target, unit), { throwIfNoEntry: false })) {
    return { action: 'add' }
  }

  const sourceFiles = new Set(files.map((file) => file.path))

  // A file the target still tracks on disk but the source no longer ships makes the unit stale. Untracked
  // extras (dependencies, build output) are ignored, so an unchanged template keeps its installed state.
  for (const tracked of targetTracked) {
    if (tracked !== unit && !tracked.startsWith(`${unit}/`)) {
      continue
    }

    if (!sourceFiles.has(tracked) && lstatSync(join(target, tracked), { throwIfNoEntry: false })) {
      return { action: 'update' }
    }
  }

  return files.every((file) => fileUnchanged(source, target, file)) ? { action: 'unchanged' } : { action: 'update' }
}

/**
 * Deletes a template from the target while keeping every gitignored path alive, pruning directories that end up
 * empty. Returns whether the unit was removed entirely.
 */
function pruneUnit(target: string, relative: string, ignored: Set<string>): boolean {
  if (ignored.has(relative)) {
    return false
  }

  const fullPath = join(target, relative)
  const stats = lstatSync(fullPath, { throwIfNoEntry: false })

  if (!stats) {
    return true
  }

  if (!stats.isDirectory()) {
    rmSync(fullPath, { force: true })
    return true
  }

  let removedAll = true

  for (const entry of readdirSync(fullPath, { encoding: 'utf8' })) {
    removedAll = pruneUnit(target, posix.join(relative, entry), ignored) && removedAll
  }

  if (removedAll) {
    rmdirSync(fullPath)
  }

  return removedAll
}

function readRepositoryGroups(root: string, label: string): TemplateGroupConfig[] {
  const packageJsonPath = join(root, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error(`${label} repository has no package.json in ${root}`)
  }

  let value: unknown

  try {
    value = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} repository package.json is not valid JSON: ${error}`)
  }

  const result = TemplateRepositoryPackageJsonSchema.safeParse(value)

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`,
    )

    throw new Error(`${label} repository package.json is invalid:\n- ${issues.join('\n- ')}`)
  }

  return result.data.repokit.groups
}
