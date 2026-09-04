import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createApp } from '../src/app.ts'
import type { TemplatesCheckCommandOptions } from '../src/templates/templates-feature-check.ts'
import type { TemplatesGenerateCommandOptions } from '../src/templates/templates-feature-generate.ts'
import {
  applyTemplateSync,
  checkTemplateRepository,
  planTemplateSync,
  renderTemplateRepository,
  runTemplatesCheck,
  runTemplatesGenerate,
  runTemplatesSync,
  TemplateGroupConfigSchema,
  TemplatePackageJsonSchema,
  TemplateRepositoryPackageJsonSchema,
  type TrackedFile,
  writeTemplateRepository,
} from '../src/templates.ts'

const fixtureRoot = new URL('./fixtures/template-repository/', import.meta.url)
const expectedArtifacts = [
  {
    content: '[\n  "mobile/example"\n]\n',
    path: '.github/workflows/templates.json',
  },
  {
    content:
      '# Mobile\n\nMobile templates\n\n### [example](mobile/example)\n\n`gh:example/templates/mobile/example`\n\n> An example mobile template.\n\n`example` `mobile`',
    path: 'TEMPLATES.md',
  },
  {
    content:
      '[\n  {\n    "description": "Mobile templates",\n    "name": "Mobile",\n    "path": "mobile",\n    "templates": [\n      {\n        "description": "An example mobile template.",\n        "id": "gh:example/templates/mobile/example",\n        "image": "mobile/example/og-image.png",\n        "keywords": [\n          "example",\n          "mobile"\n        ],\n        "name": "example",\n        "path": "mobile/example",\n        "displayName": "Example Mobile",\n        "usecase": "Mobile"\n      }\n    ]\n  }\n]\n',
    path: 'templates.json',
  },
]
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('templates', () => {
  test('exports repository configuration and package schemas', () => {
    expect(
      TemplateGroupConfigSchema.safeParse({ description: 'Mobile templates', name: 'Mobile', path: 'mobile' }).success,
    ).toBe(true)
    expect(
      TemplatePackageJsonSchema.safeParse({
        description: 'An example mobile template.',
        keywords: ['example', 'mobile'],
        name: 'example',
      }).success,
    ).toBe(true)
    expect(
      TemplateRepositoryPackageJsonSchema.safeParse({
        repokit: { groups: [{ description: 'Mobile templates', name: 'Mobile', path: 'mobile' }] },
        repository: { name: 'example/templates' },
      }).success,
    ).toBe(true)
  })

  test('renders every managed artifact byte-for-byte', () => {
    const root = copyFixture()

    expect(renderTemplateRepository(root)).toEqual(expectedArtifacts)
  })

  test('throws when rendering an invalid repository', () => {
    const root = copyFixture()
    unlinkSync(join(root, 'mobile/example/og-image.png'))

    expect(() => renderTemplateRepository(root)).toThrow('mobile/example/og-image.png is missing')
  })

  test('passes when every artifact matches', () => {
    const result = checkTemplateRepository(copyFixture())

    expect(result.issues).toEqual([])
    expect(result.artifacts).toEqual(expectedArtifacts)
  })

  test('publishes templates with a placeholder name under their directory name', () => {
    const root = copyFixture()

    writeManifest(root, (manifest) => {
      manifest.name = '{{project-name}}'
    })

    expect(checkTemplateRepository(root).issues).toEqual([])
  })

  test('reports malformed init configuration through the upstream schema', () => {
    const root = copyFixture()

    writeManifest(root, (manifest) => {
      manifest['create-solana-dapp'] = { skills: 'wallet-ui' }
    })

    expect(checkTemplateRepository(root).issues).toContain(
      'mobile/example/package.json create-solana-dapp.skills: Invalid input: expected array, received string',
    )
  })

  test('reports malformed repository configuration through the local schema', () => {
    const root = copyFixture()
    const packageJsonPath = join(root, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

    packageJson.repokit.groups = []
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    expect(checkTemplateRepository(root).issues.join('\n')).toContain('package.json repokit.groups')
  })

  test('reports a missing repository manifest', () => {
    const root = copyFixture()
    unlinkSync(join(root, 'package.json'))

    expect(checkTemplateRepository(root).issues).toEqual(['package.json is missing'])
  })

  test('reports malformed template metadata through the local schema', () => {
    const root = copyFixture()

    writeManifest(root, (manifest) => {
      manifest.keywords = []
    })

    expect(checkTemplateRepository(root).issues.join('\n')).toContain('mobile/example/package.json keywords')
  })

  test('reports duplicate template names', () => {
    const root = copyFixture()

    cpSync(join(root, 'mobile/example'), join(root, 'mobile/duplicate'), { recursive: true })

    expect(checkTemplateRepository(root).issues.join('\n')).toContain('Duplicate template name "example"')
  })

  test('reports template directories without a package manifest', () => {
    const root = copyFixture()
    mkdirSync(join(root, 'mobile/incomplete'))

    expect(checkTemplateRepository(root).issues).toContain('mobile/incomplete/package.json is missing')
  })

  test('reports missing template images', () => {
    const root = copyFixture()
    unlinkSync(join(root, 'mobile/example/og-image.png'))

    expect(checkTemplateRepository(root).issues).toContain('mobile/example/og-image.png is missing')
  })

  test('reports invalid template images', () => {
    const root = copyFixture()
    writeFileSync(join(root, 'mobile/example/og-image.png'), 'not a png')

    expect(checkTemplateRepository(root).issues).toContain('mobile/example/og-image.png is not a valid PNG')
  })

  test('reports incorrectly sized template images', () => {
    const root = copyFixture()
    writeFileSync(join(root, 'mobile/example/og-image.png'), createPng(640, 320))

    expect(checkTemplateRepository(root).issues).toContain(
      'mobile/example/og-image.png dimensions are 640x320, expected 1200x630',
    )
  })

  test('reports oversized template images', () => {
    const root = copyFixture()
    const image = Buffer.alloc(500 * 1024 + 1)
    createPng(1200, 630).copy(image)
    writeFileSync(join(root, 'mobile/example/og-image.png'), image)

    expect(checkTemplateRepository(root).issues).toContain('mobile/example/og-image.png exceeds 500KB')
  })

  test('reports every issue in one pass', () => {
    const root = copyFixture()

    mkdirSync(join(root, 'mobile/incomplete'))
    cpSync(join(root, 'mobile/example'), join(root, 'mobile/second'), { recursive: true })
    writeFileSync(join(root, 'mobile/second/og-image.png'), createPng(640, 320))

    expect(checkTemplateRepository(root).issues).toEqual([
      'mobile/incomplete/package.json is missing',
      'mobile/second/og-image.png dimensions are 640x320, expected 1200x630',
      'Duplicate template name "example" found in mobile/example and mobile/second',
    ])
  })

  test('reports no templates for an empty repository', () => {
    const root = copyFixture()
    rmSync(join(root, 'mobile/example'), { recursive: true })

    expect(checkTemplateRepository(root).issues).toEqual(['No templates found'])
  })

  test('reports missing artifacts without writing them', () => {
    const root = copyFixture()
    const catalogPath = join(root, 'templates.json')

    unlinkSync(catalogPath)

    expect(checkTemplateRepository(root).issues).toEqual(['templates.json: missing'])
    expect(() => readFileSync(catalogPath, 'utf8')).toThrow()
  })

  test('reports stale artifacts without changing them', () => {
    const root = copyFixture()
    const markdownPath = join(root, 'TEMPLATES.md')

    writeFileSync(markdownPath, 'stale\n')

    expect(checkTemplateRepository(root).issues).toEqual(['TEMPLATES.md: differs'])
    expect(readFileSync(markdownPath, 'utf8')).toBe('stale\n')
  })

  test('reports an invalid checked-in catalog', () => {
    const root = copyFixture()

    writeFileSync(join(root, 'templates.json'), '[{ "name": "Mobile" }]\n')

    expect(checkTemplateRepository(root).issues.join('\n')).toContain('templates.json: invalid')
  })

  test('writes missing artifacts and their parent directories', () => {
    const root = copyFixture()

    rmSync(join(root, '.github'), { recursive: true })
    unlinkSync(join(root, 'templates.json'))

    expect(writeTemplateRepository(root)).toEqual([
      { path: '.github/workflows/templates.json', status: 'written' },
      { path: 'TEMPLATES.md', status: 'unchanged' },
      { path: 'templates.json', status: 'written' },
    ])

    for (const artifact of expectedArtifacts) {
      expect(readFileSync(join(root, artifact.path), 'utf8')).toBe(artifact.content)
    }
  })

  test('rewrites stale artifacts', () => {
    const root = copyFixture()
    const markdownPath = join(root, 'TEMPLATES.md')

    writeFileSync(markdownPath, 'stale\n')

    expect(writeTemplateRepository(root)).toContainEqual({ path: 'TEMPLATES.md', status: 'written' })
    expect(readFileSync(markdownPath, 'utf8')).not.toBe('stale\n')
  })

  test('leaves up to date artifacts unchanged', () => {
    expect(writeTemplateRepository(copyFixture())).toEqual([
      { path: '.github/workflows/templates.json', status: 'unchanged' },
      { path: 'TEMPLATES.md', status: 'unchanged' },
      { path: 'templates.json', status: 'unchanged' },
    ])
  })

  test('throws before writing when the repository is invalid', () => {
    const root = copyFixture()
    const markdownPath = join(root, 'TEMPLATES.md')

    unlinkSync(join(root, 'mobile/example/og-image.png'))
    writeFileSync(markdownPath, 'stale\n')

    expect(() => writeTemplateRepository(root)).toThrow('mobile/example/og-image.png is missing')
    expect(readFileSync(markdownPath, 'utf8')).toBe('stale\n')
  })

  test('refuses to write through a dangling artifact symlink', () => {
    const root = copyFixture()
    const outsidePath = join(root, '..', `${basename(root)}-victim.json`)

    unlinkSync(join(root, 'templates.json'))
    symlinkSync(outsidePath, join(root, 'templates.json'))

    expect(() => writeTemplateRepository(root)).toThrow(
      'Refusing to write template artifacts:\n- templates.json is a symbolic link',
    )
    expect(existsSync(outsidePath)).toBe(false)
  })

  test('refuses to write through a symlinked artifact file without touching its target', () => {
    const root = copyFixture()
    const outsidePath = join(root, '..', `${basename(root)}-victim.md`)

    writeFileSync(outsidePath, 'victim\n')
    temporaryRoots.push(outsidePath)
    unlinkSync(join(root, 'TEMPLATES.md'))
    symlinkSync(outsidePath, join(root, 'TEMPLATES.md'))

    expect(() => writeTemplateRepository(root)).toThrow('TEMPLATES.md is a symbolic link')
    expect(readFileSync(outsidePath, 'utf8')).toBe('victim\n')
  })

  test('refuses to write through a symlinked parent directory before writing anything', () => {
    const root = copyFixture()
    const outsideDirectory = join(root, '..', `${basename(root)}-victim-directory`)

    mkdirSync(outsideDirectory, { recursive: true })
    temporaryRoots.push(outsideDirectory)
    rmSync(join(root, '.github'), { recursive: true })
    symlinkSync(outsideDirectory, join(root, '.github'))
    unlinkSync(join(root, 'templates.json'))

    expect(() => writeTemplateRepository(root)).toThrow(
      'Refusing to write template artifacts:\n- .github is a symbolic link',
    )
    expect(readdirSync(outsideDirectory)).toEqual([])
    expect(existsSync(join(root, 'templates.json'))).toBe(false)
  })

  test('reports symlinked artifacts when checking', () => {
    const root = copyFixture()
    const markdownPath = join(root, 'TEMPLATES.md')
    const markdownTargetPath = join(root, 'TEMPLATES-target.md')

    // The target has the expected content, so only the symlink itself can fail the check.
    cpSync(markdownPath, markdownTargetPath)
    unlinkSync(markdownPath)
    symlinkSync(markdownTargetPath, markdownPath)

    expect(checkTemplateRepository(root).issues).toEqual(['TEMPLATES.md is a symbolic link'])
  })
})

describe('templates check command', () => {
  test('reports up to date artifacts', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const outros: string[] = []

    try {
      await runTemplatesCheck(
        { root: copyFixture() },
        {
          cancel: (message) => cancellations.push(message),
          intro: () => {},
          outro: (message) => outros.push(message),
        },
      )

      expect(outros).toEqual(['Template artifacts are up to date'])
      expect(cancellations).toEqual([])
      expect(process.exitCode ?? 0).toBe(0)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('fails with every reported issue', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const outros: string[] = []
    const root = copyFixture()

    // Artifacts are only compared once the repository is valid, so the stale artifact is not reported yet.
    unlinkSync(join(root, 'mobile/example/og-image.png'))
    writeFileSync(join(root, 'TEMPLATES.md'), 'stale\n')

    try {
      await runTemplatesCheck(
        { root },
        {
          cancel: (message) => cancellations.push(message),
          intro: () => {},
          outro: (message) => outros.push(message),
        },
      )

      expect(cancellations).toEqual(['Template repository check failed:\n- mobile/example/og-image.png is missing'])
      expect(outros).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('fails when the check throws unexpectedly', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []

    try {
      await runTemplatesCheck(
        {},
        {
          cancel: (message) => cancellations.push(message),
          checkRepository: () => {
            throw new Error('boom')
          },
          intro: () => {},
          outro: () => {},
        },
      )

      expect(cancellations).toEqual(['Error: boom'])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('checks the current directory by default', async () => {
    const roots: string[] = []

    await runTemplatesCheck(
      {},
      {
        cancel: () => {},
        checkRepository: (root) => {
          roots.push(root)
          return { artifacts: [], issues: [] }
        },
        intro: () => {},
        outro: () => {},
      },
    )

    expect(roots).toEqual([process.cwd()])
  })
})

describe('templates generate command', () => {
  test('reports every written artifact', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const logs: string[] = []
    const outros: string[] = []
    const root = copyFixture()

    unlinkSync(join(root, 'templates.json'))

    try {
      await runTemplatesGenerate(
        { root },
        {
          cancel: (message) => cancellations.push(message),
          intro: () => {},
          log: (message) => logs.push(message),
          outro: (message) => outros.push(message),
        },
      )

      expect(logs).toEqual([
        '.github/workflows/templates.json: unchanged',
        'TEMPLATES.md: unchanged',
        'templates.json: written',
      ])
      expect(outros).toEqual(['Generated 1 of 3 artifacts'])
      expect(cancellations).toEqual([])
      expect(process.exitCode ?? 0).toBe(0)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('reports up to date artifacts', async () => {
    const outros: string[] = []

    await runTemplatesGenerate(
      { root: copyFixture() },
      {
        cancel: () => {},
        intro: () => {},
        log: () => {},
        outro: (message) => outros.push(message),
      },
    )

    expect(outros).toEqual(['Template artifacts are up to date'])
  })

  test('fails when the repository is invalid', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const outros: string[] = []
    const root = copyFixture()

    unlinkSync(join(root, 'mobile/example/og-image.png'))

    try {
      await runTemplatesGenerate(
        { root },
        {
          cancel: (message) => cancellations.push(message),
          intro: () => {},
          log: () => {},
          outro: (message) => outros.push(message),
        },
      )

      expect(cancellations).toEqual([
        'Error: Template repository is invalid:\n- mobile/example/og-image.png is missing',
      ])
      expect(outros).toEqual([])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('generates in the current directory by default', async () => {
    const roots: string[] = []

    await runTemplatesGenerate(
      {},
      {
        cancel: () => {},
        intro: () => {},
        log: () => {},
        outro: () => {},
        writeRepository: (root) => {
          roots.push(root)
          return []
        },
      },
    )

    expect(roots).toEqual([process.cwd()])
  })
})

const repositoryManifest = JSON.stringify({
  repokit: { groups: [{ description: 'Mobile templates', name: 'Mobile', path: 'mobile' }] },
  repository: { name: 'example/templates' },
})

describe('templates sync', () => {
  test('plans add, update, remove, and unchanged actions', async () => {
    const source = createRepo({
      'mobile/added/package.json': '{ "name": "added" }',
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/updated/package.json': '{ "name": "updated" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'mobile/example/node_modules/dep.js': 'ignored',
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/stale/package.json': '{ "name": "stale" }',
      'mobile/updated/package.json': '{ "name": "old" }',
      'package.json': repositoryManifest,
    })

    const plan = await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })

    expect(plan.groups).toEqual(['mobile'])
    expect(plan.actions.map(({ action, path }) => `${action} ${path}`)).toEqual([
      'add mobile/added',
      'unchanged mobile/example',
      'remove mobile/stale',
      'update mobile/updated',
    ])
  })

  test('plans an update when the target tracks a file the source no longer ships', async () => {
    const source = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/example/removed-upstream.ts': 'stale',
      'package.json': repositoryManifest,
    })

    const plan = await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })

    expect(plan.actions).toEqual([
      {
        action: 'update',
        files: [{ executable: false, path: 'mobile/example/package.json', symlink: false }],
        ignored: [],
        path: 'mobile/example',
      },
    ])
  })

  test('preserves gitignored target files when updating a template', async () => {
    const source = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'mobile/example/.env': 'SECRET=1',
      'mobile/example/package.json': '{ "name": "old" }',
      'package.json': repositoryManifest,
    })

    applyTemplateSync(source, target, await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles }))

    expect(readFileSync(join(target, 'mobile/example/package.json'), 'utf8')).toBe('{ "name": "example" }')
    // The gitignored local env file is not restorable from git, so the sync must not delete it.
    expect(readFileSync(join(target, 'mobile/example/.env'), 'utf8')).toBe('SECRET=1')
  })

  test('keeps a removed template directory that still contains gitignored files', async () => {
    const source = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/stale/.env': 'SECRET=1',
      'mobile/stale/package.json': '{ "name": "stale" }',
      'package.json': repositoryManifest,
    })

    const kept = applyTemplateSync(
      source,
      target,
      await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles }),
    )

    expect(kept).toEqual(['mobile/stale'])
    expect(readFileSync(join(target, 'mobile/stale/.env'), 'utf8')).toBe('SECRET=1')
    expect(existsSync(join(target, 'mobile/stale/package.json'))).toBe(false)
  })

  test('preserves symlinks instead of dereferencing them', async () => {
    const source = createRepo({
      '.env': 'SECRET=1',
      'mobile/example/package.json': '{ "name": "example" }',
      'package.json': repositoryManifest,
    })
    symlinkSync('../../.env', join(source, 'mobile/example/env-link'))
    const target = createRepo({ 'package.json': repositoryManifest })

    applyTemplateSync(source, target, await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles }))

    const linkPath = join(target, 'mobile/example/env-link')

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linkPath)).toBe('../../.env')
    // The gitignored secret behind the link stays behind; the target only receives the (dangling) link.
    expect(existsSync(join(target, '.env'))).toBe(false)

    const plan = await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })

    expect(plan.actions.map(({ action }) => action)).toEqual(['unchanged'])
  })

  test('preserves the executable bit and treats a mode change as an update', async () => {
    const source = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/example/script.sh': '#!/bin/sh\n',
      'package.json': repositoryManifest,
    })
    chmodSync(join(source, 'mobile/example/script.sh'), 0o755)
    const target = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/example/script.sh': '#!/bin/sh\n',
      'package.json': repositoryManifest,
    })

    // Same bytes everywhere, but the target lost the executable bit.
    const plan = await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })

    expect(plan.actions.map(({ action, path }) => `${action} ${path}`)).toEqual(['update mobile/example'])

    applyTemplateSync(source, target, plan)

    expect(lstatSync(join(target, 'mobile/example/script.sh')).mode & 0o111).toBe(0o111)

    const replan = await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })

    expect(replan.actions.map(({ action }) => action)).toEqual(['unchanged'])
  })

  test('throws when the target does not declare the group', async () => {
    const source = createRepo({
      'mobile/example/package.json': '{ "name": "example" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'package.json': JSON.stringify({
        repokit: { groups: [{ description: 'Web templates', name: 'Web', path: 'web' }] },
        repository: { name: 'example/other-templates' },
      }),
    })

    await expect(planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })).rejects.toThrow(
      'Target repository does not declare a group with path "mobile"',
    )
  })

  test('throws when the source has no tracked files in a group', async () => {
    const source = createRepo({ 'package.json': repositoryManifest })
    const target = createRepo({ 'package.json': repositoryManifest })

    await expect(planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles })).rejects.toThrow(
      'Source repository has no tracked files under "mobile"',
    )
  })

  test('throws when source and target are the same directory', async () => {
    const root = createRepo({ 'package.json': repositoryManifest })

    await expect(planTemplateSync(root, root, { listIgnoredFiles, listTrackedFiles })).rejects.toThrow(
      'Source and target repositories are the same directory',
    )
  })

  test('applies the plan as a mirror of the tracked source files', async () => {
    const source = createRepo({
      'mobile/added/package.json': '{ "name": "added" }',
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/updated/package.json': '{ "name": "updated" }',
      'package.json': repositoryManifest,
    })
    const target = createRepo({
      'mobile/example/node_modules/dep.js': 'ignored',
      'mobile/example/package.json': '{ "name": "example" }',
      'mobile/stale/package.json': '{ "name": "stale" }',
      'mobile/updated/dropped.ts': 'stale',
      'mobile/updated/package.json': '{ "name": "old" }',
      'package.json': repositoryManifest,
    })

    applyTemplateSync(source, target, await planTemplateSync(source, target, { listIgnoredFiles, listTrackedFiles }))

    expect(readFileSync(join(target, 'mobile/added/package.json'), 'utf8')).toBe('{ "name": "added" }')
    expect(readFileSync(join(target, 'mobile/updated/package.json'), 'utf8')).toBe('{ "name": "updated" }')
    expect(existsSync(join(target, 'mobile/stale'))).toBe(false)
    expect(existsSync(join(target, 'mobile/updated/dropped.ts'))).toBe(false)
    // Unchanged templates are left alone, so untracked files like installed dependencies survive the sync.
    expect(existsSync(join(target, 'mobile/example/node_modules/dep.js'))).toBe(true)
  })
})

describe('templates sync command', () => {
  test('syncs the source templates and reports a summary', async () => {
    const outros: string[] = []
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    await runTemplatesSync(
      { root: source, target },
      {
        cancel: () => {},
        info: () => {},
        intro: () => {},
        listChanges: async () => [],
        listTrackedFiles,
        outro: (message) => outros.push(message),
      },
    )

    expect(existsSync(join(target, 'mobile/example/package.json'))).toBe(true)
    expect(outros.join('\n')).toContain('1 added, 0 updated, 0 removed, 0 unchanged')
  })

  test('refuses to overwrite a dirty target without --force', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    try {
      await runTemplatesSync(
        { root: source, target },
        {
          cancel: (message) => cancellations.push(message),
          info: () => {},
          intro: () => {},
          listChanges: async () => [' M mobile/example/local-change.ts'],
          listTrackedFiles,
          outro: () => {},
        },
      )

      expect(cancellations.join('\n')).toContain('uncommitted changes')
      expect(existsSync(join(target, 'mobile'))).toBe(false)
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('overwrites a dirty target with --force', async () => {
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    await runTemplatesSync(
      { force: true, root: source, target },
      {
        cancel: () => {},
        info: () => {},
        intro: () => {},
        listChanges: async () => {
          throw new Error('must not be called')
        },
        listTrackedFiles,
        outro: () => {},
      },
    )

    expect(existsSync(join(target, 'mobile/example/package.json'))).toBe(true)
  })

  test('writes nothing on a dry run', async () => {
    const outros: string[] = []
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    await runTemplatesSync(
      { dryRun: true, root: source, target },
      {
        cancel: () => {},
        info: () => {},
        intro: () => {},
        listTrackedFiles,
        outro: (message) => outros.push(message),
      },
    )

    expect(existsSync(join(target, 'mobile'))).toBe(false)
    expect(outros.join('\n')).toContain('Dry run')
  })

  test('reports an up to date target without writing', async () => {
    const outros: string[] = []
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    cpSync(join(source, 'mobile'), join(target, 'mobile'), { recursive: true })

    await runTemplatesSync(
      { root: source, target },
      {
        cancel: () => {},
        info: () => {},
        intro: () => {},
        listTrackedFiles,
        outro: (message) => outros.push(message),
      },
    )

    expect(outros).toEqual(['Target repository is up to date with mobile'])
  })

  test('fails when the source repository check fails', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const source = copyFixture()
    const target = createRepo({ 'package.json': repositoryManifest })

    unlinkSync(join(source, 'mobile/example/og-image.png'))

    try {
      await runTemplatesSync(
        { root: source, target },
        {
          cancel: (message) => cancellations.push(message),
          info: () => {},
          intro: () => {},
          listTrackedFiles,
          outro: () => {},
        },
      )

      expect(cancellations).toEqual(['Source repository check failed:\n- mobile/example/og-image.png is missing'])
      expect(existsSync(join(target, 'mobile'))).toBe(false)
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('fails when planning throws', async () => {
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const source = copyFixture()
    const target = createRepo({})

    try {
      await runTemplatesSync(
        { root: source, target },
        {
          cancel: (message) => cancellations.push(message),
          info: () => {},
          intro: () => {},
          listTrackedFiles,
          outro: () => {},
        },
      )

      expect(cancellations.join('\n')).toContain('Target repository has no package.json')
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })
})

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'solana-mobile-templates-'))
  temporaryRoots.push(root)
  cpSync(fixtureRoot, root, { recursive: true })
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  for (const artifact of expectedArtifacts) {
    writeFileSync(join(root, artifact.path), artifact.content)
  }
  writeFileSync(join(root, 'mobile/example/og-image.png'), createPng(1200, 630))

  return root
}

function createPng(width: number, height: number) {
  const image = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image)
  image.write('IHDR', 12, 'ascii')
  image.writeUInt32BE(width, 16)
  image.writeUInt32BE(height, 20)
  return image
}

function createRepo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'solana-mobile-templates-sync-'))
  temporaryRoots.push(root)

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

/** Stands in for git's ignore listing by treating dependency directories and env files as ignored. */
async function listIgnoredFiles(root: string, path: string): Promise<string[]> {
  const ignored: string[] = []

  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const entryPath = `${relative}/${entry.name}`

      if (entry.name === 'node_modules' || entry.name === '.env') {
        ignored.push(entryPath)
      } else if (entry.isDirectory()) {
        walk(entryPath)
      }
    }
  }

  const stats = lstatSync(join(root, path), { throwIfNoEntry: false })

  if (stats?.isDirectory()) {
    walk(path)
  }

  return ignored.sort((left, right) => left.localeCompare(right))
}

/** Stands in for `git ls-files` by treating everything on disk as tracked, except dependency directories. */
async function listTrackedFiles(root: string, path: string): Promise<TrackedFile[]> {
  const files: TrackedFile[] = []

  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const entryPath = `${relative}/${entry.name}`

      if (entry.name === 'node_modules') {
        continue
      }

      if (entry.isDirectory()) {
        walk(entryPath)
      } else {
        const stats = lstatSync(join(root, entryPath))

        files.push({
          executable: !stats.isSymbolicLink() && (stats.mode & 0o100) !== 0,
          path: entryPath,
          symlink: stats.isSymbolicLink(),
        })
      }
    }
  }

  if (existsSync(join(root, path))) {
    walk(path)
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function writeManifest(root: string, update: (manifest: Record<string, unknown>) => void) {
  const manifestPath = join(root, 'mobile/example/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  update(manifest)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

describe('templates command', () => {
  test('registers templates subcommands', () => {
    const templatesCommand = createApp().commands.find((command) => command.name() === 'templates')

    expect(templatesCommand?.commands.map((command) => command.name())).toEqual(['check', 'generate', 'sync'])
  })

  test('does not delegate templates command to check', async () => {
    const templatesCheckOptions: TemplatesCheckCommandOptions[] = []
    const app = createApp({
      runTemplatesCheck: async (options) => {
        templatesCheckOptions.push(options)
      },
    })
    const templatesCommand = app.commands.find((command) => command.name() === 'templates')

    templatesCommand?.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates'])

    expect(templatesCheckOptions).toEqual([])
  })

  test('delegates templates check command options', async () => {
    const templatesCheckOptions: TemplatesCheckCommandOptions[] = []
    const app = createApp({
      runTemplatesCheck: async (options) => {
        templatesCheckOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates', 'check', '--root', '/repo'])

    expect(templatesCheckOptions).toEqual([{ root: '/repo' }])
  })

  test('delegates templates generate command options', async () => {
    const templatesGenerateOptions: TemplatesGenerateCommandOptions[] = []
    const app = createApp({
      runTemplatesGenerate: async (options) => {
        templatesGenerateOptions.push(options)
      },
    })

    await app.parseAsync(['node', 'solana-mobile', 'templates', 'generate', '--root', '/repo'])

    expect(templatesGenerateOptions).toEqual([{ root: '/repo' }])
  })
})
