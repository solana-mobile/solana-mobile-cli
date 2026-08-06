import type { Dirent } from 'node:fs'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { parseTemplateJson, type TemplateJsonGroup, type TemplateJsonTemplate } from 'create-solana-dapp'
import type { z } from 'zod'
import {
  type TemplateGroupConfig,
  TemplatePackageJsonSchema,
  TemplateRepositoryPackageJsonSchema,
} from './template-repository-schema.ts'

export interface TemplateRepositoryArtifact {
  content: string
  path: string
}

export interface TemplateRepositoryCheckResult {
  artifacts: TemplateRepositoryArtifact[]
  issues: string[]
}

export interface TemplateRepositoryWriteResult {
  path: string
  status: 'unchanged' | 'written'
}

export interface TemplateMetadata {
  description: string
  displayName?: string
  keywords: string[]
  name: string
  path: string
  usecase?: string
}

export interface TemplateRepository {
  groups: TemplateRepositoryGroup[]
  repositoryName: string
}

export interface TemplateRepositoryGroup extends TemplateGroupConfig {
  templates: TemplateMetadata[]
}

interface SchemaIssue {
  message: string
  path: PropertyKey[]
}

interface LoadedValue<T> {
  issues: string[]
  value?: T
}

const catalogArtifactPath = 'templates.json'
const imageHeight = 630
const imageMaxBytes = 500 * 1024
const imageName = 'og-image.png'
const imageWidth = 1200
const markdownArtifactPath = 'TEMPLATES.md'
const pngHeaderBytes = 24
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const
const workflowArtifactPath = '.github/workflows/templates.json'

/**
 * Collects everything that is wrong with a template repository without writing anything.
 *
 * Every template is validated before any artifact is compared, so a repository can be fixed in a single pass instead of
 * one error per run. Artifacts are only compared once the repository itself is valid, because artifacts rendered from an
 * incomplete set of templates would report differences that are not real.
 */
export function checkTemplateRepository(root: string): TemplateRepositoryCheckResult {
  const repository = loadTemplateRepository(root)

  if (!repository.value) {
    return { artifacts: [], issues: repository.issues }
  }

  const artifacts = renderArtifacts(repository.value)

  return { artifacts, issues: artifacts.flatMap((artifact) => compareArtifact(root, artifact)) }
}

export function renderTemplateRepository(root: string): TemplateRepositoryArtifact[] {
  const repository = loadTemplateRepository(root)

  if (!repository.value) {
    throw new Error(`Template repository is invalid:\n- ${repository.issues.join('\n- ')}`)
  }

  return renderArtifacts(repository.value)
}

/**
 * Writes the rendered artifacts to disk, skipping files that are already byte-identical so an up-to-date repository
 * keeps its file timestamps and the caller can report what actually changed. Every artifact path is checked for
 * symlinks before anything is written, so a refused repository is left exactly as it was found.
 */
export function writeTemplateRepository(root: string): TemplateRepositoryWriteResult[] {
  const artifacts = renderTemplateRepository(root)
  const issues = artifacts.flatMap((artifact) => findSymlinkedPathComponents(root, artifact.path))

  if (issues.length > 0) {
    throw new Error(`Refusing to write template artifacts:\n- ${issues.join('\n- ')}`)
  }

  return artifacts.map((artifact) => {
    const artifactPath = join(root, artifact.path)

    if (existsSync(artifactPath) && readFileSync(artifactPath, 'utf8') === artifact.content) {
      return { path: artifact.path, status: 'unchanged' }
    }

    mkdirSync(dirname(artifactPath), { recursive: true })
    writeFileSync(artifactPath, artifact.content)

    return { path: artifact.path, status: 'written' }
  })
}

function compareArtifact(root: string, artifact: TemplateRepositoryArtifact): string[] {
  const symlinked = findSymlinkedPathComponents(root, artifact.path)

  if (symlinked.length > 0) {
    return symlinked
  }

  const artifactPath = join(root, artifact.path)

  if (!existsSync(artifactPath)) {
    return [`${artifact.path}: missing`]
  }

  const content = readFileSync(artifactPath, 'utf8')

  if (artifact.path === catalogArtifactPath) {
    const parsedCatalog = parseTemplateJson(content)
    if (!parsedCatalog.success) {
      return [`${catalogArtifactPath}: invalid${formatSchemaIssues(parsedCatalog.error.issues)}`]
    }
  }

  return content === artifact.content ? [] : [`${artifact.path}: differs`]
}

function discoverTemplates(
  root: string,
  group: TemplateGroupConfig,
): { issues: string[]; templates: TemplateMetadata[] } {
  const groupDirectory = join(root, group.path)
  const issues: string[] = []
  const templates: TemplateMetadata[] = []
  let entries: Dirent<string>[]

  try {
    entries = readdirSync(groupDirectory, { encoding: 'utf8', withFileTypes: true })
  } catch (error) {
    return { issues: [`Failed to read template group ${group.path}: ${error}`], templates }
  }

  const directoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  for (const directoryName of directoryNames) {
    const templatePath = posix.join(group.path, directoryName)
    const manifestPath = `${templatePath}/package.json`
    const manifest = readJsonFile(root, manifestPath, TemplatePackageJsonSchema)

    if (!manifest.value) {
      issues.push(...manifest.issues)
      continue
    }

    issues.push(...validateTemplateImage(root, templatePath))

    templates.push({
      description: manifest.value.description,
      displayName: manifest.value.displayName,
      keywords: manifest.value.keywords,
      // Templates that ship a placeholder name (`{{project-name}}`) are published under their directory name.
      name: manifest.value.name.includes('{{') ? directoryName : manifest.value.name,
      path: templatePath,
      usecase: manifest.value.usecase,
    })
  }

  return { issues, templates }
}

/**
 * Reading and writing through a symlinked artifact path would touch whatever the link points to — a checked-in
 * `templates.json -> ../elsewhere` would let `writeTemplateRepository` overwrite an arbitrary writable path outside
 * the repository. Every path component is inspected with `lstat` because `existsSync` follows links, so a dangling
 * symlink looks like a missing file while still redirecting the write that would create it.
 */
function findSymlinkedPathComponents(root: string, artifactPath: string): string[] {
  let currentLabel = ''
  let currentPath = root

  for (const segment of artifactPath.split(posix.sep)) {
    currentLabel = currentLabel === '' ? segment : posix.join(currentLabel, segment)
    currentPath = join(currentPath, segment)

    const stats = lstatSync(currentPath, { throwIfNoEntry: false })

    if (!stats) {
      return []
    }

    if (stats.isSymbolicLink()) {
      return [`${currentLabel} is a symbolic link`]
    }
  }

  return []
}

function extractTemplatePaths(groups: TemplateJsonGroup[]) {
  return groups
    .flatMap((group) => group.templates.map((template) => template.path))
    .sort((left, right) => left.localeCompare(right))
}

function formatIssues(label: string, issues: readonly SchemaIssue[]): string[] {
  return issues.map((issue) => `${label}${issue.path.length > 0 ? ` ${issue.path.join('.')}` : ''}: ${issue.message}`)
}

function formatSchemaIssues(issues: readonly SchemaIssue[]) {
  return issues
    .map((issue) => `\n- ${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('')
}

function loadTemplateRepository(root: string): LoadedValue<TemplateRepository> {
  const packageJson = readJsonFile(root, 'package.json', TemplateRepositoryPackageJsonSchema)

  if (!packageJson.value) {
    return { issues: packageJson.issues }
  }

  const groups: TemplateRepositoryGroup[] = []
  const issues: string[] = []
  const templatePathsByName = new Map<string, string>()

  for (const group of packageJson.value.repokit.groups) {
    const discovered = discoverTemplates(root, group)
    issues.push(...discovered.issues)

    const templates = discovered.templates.filter((template) => {
      const previousPath = templatePathsByName.get(template.name)

      if (previousPath) {
        issues.push(`Duplicate template name "${template.name}" found in ${previousPath} and ${template.path}`)
        return false
      }

      templatePathsByName.set(template.name, template.path)
      return true
    })

    groups.push({ ...group, templates })
  }

  if (templatePathsByName.size === 0) {
    issues.push('No templates found')
  }

  if (issues.length > 0) {
    return { issues }
  }

  return { issues, value: { groups, repositoryName: packageJson.value.repository.name } }
}

function readJsonFile<T>(root: string, path: string, schema: z.ZodType<T>): LoadedValue<T> {
  const filePath = join(root, path)

  if (!existsSync(filePath)) {
    return { issues: [`${path} is missing`] }
  }

  let value: unknown

  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    return { issues: [`Failed to read ${path}: ${error}`] }
  }

  const result = schema.safeParse(value)

  if (!result.success) {
    return { issues: formatIssues(path, result.error.issues) }
  }

  return { issues: [], value: result.data }
}

function renderArtifacts(repository: TemplateRepository): TemplateRepositoryArtifact[] {
  const groups = repository.groups
    .map((group) => ({
      description: group.description,
      name: group.name,
      path: group.path,
      templates: group.templates
        .map((template) => toTemplateJson(template, repository.repositoryName))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .filter((group) => group.templates.length > 0)
  const catalog = `${JSON.stringify(groups, null, 2)}\n`
  const parsedCatalog = parseTemplateJson(catalog)

  if (!parsedCatalog.success) {
    // A catalog that fails the upstream schema is a bug in this renderer, not a problem with the repository.
    throw new Error(`Rendered ${catalogArtifactPath} is invalid:${formatSchemaIssues(parsedCatalog.error.issues)}`)
  }

  return [
    {
      content: `${JSON.stringify(extractTemplatePaths(groups), null, 2)}\n`,
      path: workflowArtifactPath,
    },
    {
      content: renderTemplatesMarkdown(groups),
      path: markdownArtifactPath,
    },
    {
      content: catalog,
      path: catalogArtifactPath,
    },
  ]
}

/**
 * The rendered markdown deliberately ends without a trailing newline to stay byte-identical with the `TEMPLATES.md`
 * the template repositories already have checked in.
 */
function renderTemplatesMarkdown(groups: TemplateJsonGroup[]) {
  return groups
    .map((group) => {
      const header = [`# ${group.name}`, '', group.description, ''].join('\n')
      const templates = group.templates.map(renderTemplateMarkdown).join('\n\n')
      return `${header}\n${templates}`
    })
    .join('\n\n')
}

function renderTemplateMarkdown(template: TemplateJsonTemplate) {
  return [
    `### [${template.name}](${template.path})`,
    '',
    `\`${template.id}\``,
    '',
    `> ${template.description}`,
    '',
    template.keywords.map((keyword) => `\`${keyword}\``).join(' '),
  ].join('\n')
}

/**
 * The optional keys are appended after the required ones on purpose. This key order is what ends up in
 * `templates.json`, and it has to stay byte-identical with the catalog the template repositories already have checked
 * in, so it is the one object in this package that is not sorted alphabetically.
 */
function toTemplateJson(metadata: TemplateMetadata, repositoryName: string): TemplateJsonTemplate {
  const template = {
    description: metadata.description,
    id: `gh:${repositoryName}/${metadata.path}`,
    image: `${metadata.path}/${imageName}`,
    keywords: [...metadata.keywords],
    name: metadata.name,
    path: metadata.path,
  }
  const withDisplayName = metadata.displayName ? { ...template, displayName: metadata.displayName } : template
  return metadata.usecase ? { ...withDisplayName, usecase: metadata.usecase } : withDisplayName
}

function validateTemplateImage(root: string, templatePath: string): string[] {
  const imagePath = join(root, templatePath, imageName)
  const imageLabel = `${templatePath}/${imageName}`

  if (!existsSync(imagePath)) {
    return [`${imageLabel} is missing`]
  }

  const image = readFileSync(imagePath)
  const hasPngHeader =
    image.length >= pngHeaderBytes &&
    pngSignature.every((byte, index) => image[index] === byte) &&
    image.toString('ascii', 12, 16) === 'IHDR'

  if (!hasPngHeader) {
    return [`${imageLabel} is not a valid PNG`]
  }

  const issues: string[] = []
  const height = image.readUInt32BE(20)
  const width = image.readUInt32BE(16)

  if (width !== imageWidth || height !== imageHeight) {
    issues.push(`${imageLabel} dimensions are ${width}x${height}, expected ${imageWidth}x${imageHeight}`)
  }

  if (image.length > imageMaxBytes) {
    issues.push(`${imageLabel} exceeds ${imageMaxBytes / 1024}KB`)
  }

  return issues
}
