import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkTemplateRepository,
  renderTemplateRepository,
  runTemplatesCheck,
  TemplateGroupConfigSchema,
  TemplatePackageJsonSchema,
  TemplateRepositoryPackageJsonSchema,
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

function writeManifest(root: string, update: (manifest: Record<string, unknown>) => void) {
  const manifestPath = join(root, 'mobile/example/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  update(manifest)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
