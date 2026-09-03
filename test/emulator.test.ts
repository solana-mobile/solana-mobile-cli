import { describe, expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatCliCommand } from '../src/core/util/format-cli-command.ts'
import { createAvdConfigValues, parseAvdConfig } from '../src/emulator/data-access/avd-config.ts'
import { createAvd } from '../src/emulator/data-access/create-avd.ts'
import { deleteInstalledAvds } from '../src/emulator/data-access/delete-installed-avds.ts'
import { listEmulatorStatuses } from '../src/emulator/data-access/list-emulator-statuses.ts'
import { listInstalledAvds } from '../src/emulator/data-access/list-installed-avds.ts'
import {
  listInstalledSystemImages,
  selectDefaultSystemImage,
} from '../src/emulator/data-access/list-installed-system-images.ts'
import { listRunningEmulators } from '../src/emulator/data-access/list-running-emulators.ts'
import { resolveAndroidSdkRoot } from '../src/emulator/data-access/resolve-android-sdk-root.ts'
import { startEmulator } from '../src/emulator/data-access/start-emulator.ts'
import { stopEmulator } from '../src/emulator/data-access/stop-emulator.ts'
import {
  filterCompatibleSystemImages,
  filterSystemImagesForPlatform,
  listInstalledAndroidPlatforms,
  parseSystemImagePackages,
} from '../src/emulator/data-access/system-image-package-manager.ts'
import { applyEmulatorTweaks, tuneEmulator, waitForEmulatorBoot } from '../src/emulator/data-access/tune-emulator.ts'
import { runEmulatorCreate } from '../src/emulator/emulator-feature-create.ts'
import { runEmulatorDelete } from '../src/emulator/emulator-feature-delete.ts'
import {
  runEmulatorImages,
  runEmulatorImagesDelete,
  runEmulatorImagesInstall,
} from '../src/emulator/emulator-feature-images.ts'
import { runEmulatorStart } from '../src/emulator/emulator-feature-start.ts'
import { runEmulatorStop } from '../src/emulator/emulator-feature-stop.ts'
import { runEmulatorTune } from '../src/emulator/emulator-feature-tune.ts'

const NO_INSTALLED_SYSTEM_IMAGES_MESSAGE = [
  'No Android system images are installed.',
  'Install an Android system image with:',
  '  solana-mobile emulator images install',
].join('\n')

async function createTemporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function installAndroidCommandLineTool(sdkRoot: string, tool: string, version = 'latest') {
  const toolDirectory = join(sdkRoot, 'cmdline-tools', version, 'bin')
  await mkdir(toolDirectory, { recursive: true })
  await writeFile(join(toolDirectory, tool), '')
}

async function installAndroidPlatform(sdkRoot: string, androidPlatform: string) {
  await mkdir(join(sdkRoot, 'platforms', androidPlatform), { recursive: true })
}

async function installSystemImage(sdkRoot: string, systemImage: string) {
  const directory = join(sdkRoot, ...systemImage.split(';'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'source.properties'), '')
}

describe('emulator', () => {
  test('lists registered AVDs with config metadata sorted by name', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-list-')
    const avdRootDirectory = join(homeDirectory, '.android', 'avd')

    try {
      await mkdir(join(avdRootDirectory, 'Beta.avd'), { recursive: true })
      await mkdir(join(avdRootDirectory, 'Alpha.avd'), { recursive: true })
      await mkdir(join(avdRootDirectory, 'Ghost.avd'), { recursive: true })
      await writeFile(join(avdRootDirectory, 'Beta.ini'), 'path=Beta.avd\n')
      await writeFile(join(avdRootDirectory, 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(avdRootDirectory, 'Beta.avd', 'config.ini'), 'hw.device.name=pixel_9\ntarget=android-36\n')
      await writeFile(
        join(avdRootDirectory, 'Alpha.avd', 'config.ini'),
        'image.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/\ntarget=android-35\n',
      )

      expect(await listInstalledAvds({ getHomeDirectory: () => homeDirectory })).toEqual([
        {
          device: undefined,
          name: 'Alpha',
          systemImage: 'system-images;android-35;google_apis_playstore;arm64-v8a',
          target: 'android-35',
        },
        {
          device: 'pixel_9',
          name: 'Beta',
          systemImage: undefined,
          target: 'android-36',
        },
      ])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('parses AVD config key-value pairs', () => {
    expect(parseAvdConfig('target=android-36\nignored\nhw.device.name=pixel_9\n')).toEqual({
      'hw.device.name': 'pixel_9',
      target: 'android-36',
    })
  })

  test('configures 16 KB Google Play system images with the Google Play tag', () => {
    expect(
      createAvdConfigValues({
        dataSize: '32G',
        device: 'pixel_9_pro_xl',
        name: 'test_phone',
        ramMb: 8192,
        sdcardSize: '512M',
        sdkRoot: '/sdk',
        systemImage: 'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
        vmHeapMb: 576,
      }),
    ).toMatchObject({
      'PlayStore.enabled': 'true',
      'tag.display': 'Google Play',
    })
  })

  test('resolves Android SDK root from environment and home directory', () => {
    expect(resolveAndroidSdkRoot({ ANDROID_HOME: '/home-sdk', ANDROID_SDK_ROOT: '/root-sdk' }, '/Users/test')).toBe(
      '/root-sdk',
    )
    expect(resolveAndroidSdkRoot({ ANDROID_HOME: '/home-sdk' }, '/Users/test')).toBe('/home-sdk')
    expect(resolveAndroidSdkRoot({}, '/Users/test')).toBe('/Users/test/Library/Android/sdk')
  })

  test('lists installed system image packages alphabetically', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-images-')

    try {
      const installedImages = [
        'system-images;android-35;google_apis_playstore;arm64-v8a',
        'system-images;android-36;google_apis;arm64-v8a',
        'system-images;android-37;google_apis_playstore;arm64-v8a',
      ]

      for (const systemImage of installedImages) {
        const directory = join(sdkRoot, ...systemImage.split(';'))
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'source.properties'), '')
      }

      await mkdir(join(sdkRoot, 'system-images', 'android-38', 'google_apis_playstore', 'arm64-v8a'), {
        recursive: true,
      })

      expect(await listInstalledSystemImages(sdkRoot)).toEqual(installedImages)
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('lists installed Android platforms newest first', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-android-platforms-')

    try {
      await installAndroidPlatform(sdkRoot, 'android-36')
      await installAndroidPlatform(sdkRoot, 'android-36.1')
      await installAndroidPlatform(sdkRoot, 'android-37.0')
      await mkdir(join(sdkRoot, 'platforms', 'preview'), { recursive: true })

      expect(await listInstalledAndroidPlatforms(sdkRoot)).toEqual(['android-37.0', 'android-36.1', 'android-36'])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('selects the latest installed Google Play system image by default', () => {
    expect(
      selectDefaultSystemImage([
        'system-images;android-36;google_apis_playstore;arm64-v8a',
        'system-images;android-36.1;google_apis_playstore;arm64-v8a',
        'system-images;android-37;google_apis;arm64-v8a',
        'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
        'system-images;android-35;google_apis_playstore;arm64-v8a',
      ]),
    ).toBe('system-images;android-36.1;google_apis_playstore;arm64-v8a')
  })

  test('selects a 16 KB Google Play image when no standard image is installed', () => {
    expect(
      selectDefaultSystemImage([
        'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
        'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
      ]),
    ).toBe('system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a')
  })

  test('reports installed options when no supported system image is installed', () => {
    const installedSystemImage = 'system-images;android-36;google_apis;arm64-v8a'

    expect(() => selectDefaultSystemImage([installedSystemImage])).toThrow(
      `No supported Android system images found.\nInstalled system images:\n- ${installedSystemImage}\nList them with: solana-mobile emulator images list`,
    )
  })

  test('reports installation commands when no system images are installed', () => {
    expect(() => selectDefaultSystemImage([])).toThrow(
      `No supported Android system images found.\n${NO_INSTALLED_SYSTEM_IMAGES_MESSAGE}`,
    )
  })

  test('rejects an uninstalled system image with the installed options', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-invalid-image-')
    const sdkRoot = join(rootDirectory, 'sdk')
    const installedImages = [
      'system-images;android-35;google_apis_playstore;arm64-v8a',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ]

    try {
      for (const systemImage of installedImages) {
        const directory = join(sdkRoot, ...systemImage.split(';'))
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'source.properties'), '')
      }

      await expect(
        createAvd({
          name: 'test_phone',
          sdkRoot,
          systemImage: 'system-images;android-37;google_apis_playstore;arm64-v8a',
        }),
      ).rejects.toThrow(
        `System image is not installed: system-images;android-37;google_apis_playstore;arm64-v8a\nInstalled system images:\n- ${installedImages.join('\n- ')}\nList them with: solana-mobile emulator images list`,
      )
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('lists installed system images from the command', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-images-command-')
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const intros: string[] = []
    const logs: string[] = []

    try {
      const directory = join(sdkRoot, ...systemImage.split(';'))
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'source.properties'), '')

      await runEmulatorImages(
        { sdkRoot },
        {
          intro: (message) => intros.push(message),
          log: (message) => logs.push(message),
        },
      )

      expect(intros).toEqual(['solana-mobile emulator images list'])
      expect(logs).toEqual([systemImage])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('reports when no system images are installed', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-images-empty-')
    const notes: Array<{ message: string; title?: string }> = []
    const outros: string[] = []

    try {
      await runEmulatorImages(
        { sdkRoot },
        {
          log: () => {
            throw new Error('Unexpected raw log output.')
          },
          note: (message, title) => notes.push({ message, title }),
          outro: (message) => outros.push(message),
        },
      )

      expect(notes).toEqual([
        {
          message: 'solana-mobile emulator images install',
          title: 'No Android system images installed',
        },
      ])
      expect(outros).toEqual(['Done'])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('deletes explicit installed system images with sdkmanager', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-explicit-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const sdkmanager = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'sdkmanager')
    const systemImages = [
      'system-images;android-35;google_apis_playstore;arm64-v8a',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ]
    const commands: Array<[string, ...string[]]> = []
    const intros: string[] = []
    const logs: string[] = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '22.0')

      for (const systemImage of systemImages) {
        await installSystemImage(sdkRoot, systemImage)
      }

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages: [
            'system-images/android-36/google_apis_playstore/arm64-v8a',
            'system-images;android-35;google_apis_playstore;arm64-v8a',
          ],
        },
        {
          getHomeDirectory: () => homeDirectory,
          intro: (message) => intros.push(message),
          log: (message) => logs.push(message),
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          runMultiselect: async () => {
            throw new Error('Unexpected system image prompt.')
          },
          taskLog: () => ({
            error: () => {},
            group: () => ({ error: () => {}, message: () => {}, success: () => {} }),
            message: () => {},
            success: () => {},
          }),
        },
      )

      expect(commands).toEqual([[sdkmanager, '--uninstall', ...systemImages]])
      expect(intros).toEqual(['solana-mobile emulator images delete'])
      expect(logs).toEqual(systemImages.map((systemImage) => `Deleted system image: ${systemImage}`))
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('deletes installed system images with the Android CLI when available', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-android-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const android = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'android')
    const systemImages = [
      'system-images;android-35;google_apis_playstore;arm64-v8a',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ]
    const commands: Array<[string, ...string[]]> = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '22.0')

      for (const systemImage of systemImages) {
        await installSystemImage(sdkRoot, systemImage)
      }

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages,
        },
        {
          getHomeDirectory: () => homeDirectory,
          intro: () => {},
          log: () => {},
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          taskLog: () => ({
            error: () => {},
            group: () => ({ error: () => {}, message: () => {}, success: () => {} }),
            message: () => {},
            success: () => {},
          }),
        },
      )

      expect(commands).toEqual([
        [
          android,
          'sdk',
          'remove',
          'system-images/android-35/google_apis_playstore/arm64-v8a',
          'system-images/android-36/google_apis_playstore/arm64-v8a',
        ],
      ])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('refuses to delete a system image used by an installed emulator', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-used-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const previousExitCode = process.exitCode
    const cancellations: string[] = []
    const commands: Array<[string, ...string[]]> = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '22.0')
      await installSystemImage(sdkRoot, systemImage)
      await mkdir(join(homeDirectory, '.android', 'avd', 'local_phone.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'local_phone.ini'), 'path=local_phone.avd\n')
      await writeFile(
        join(homeDirectory, '.android', 'avd', 'local_phone.avd', 'config.ini'),
        'image.sysdir.1=system-images/android-36/google_apis_playstore/arm64-v8a/\n',
      )

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages: ['system-images/android-36/google_apis_playstore/arm64-v8a'],
        },
        {
          cancel: (message) => cancellations.push(message),
          getHomeDirectory: () => homeDirectory,
          runInteractiveCommand: async (cmd) => {
            commands.push(cmd)
          },
        },
      )

      expect(cancellations).toEqual([
        'Error: Cannot delete system images used by Android emulators:\n- system-images/android-36/google_apis_playstore/arm64-v8a: local_phone\nDelete the listed emulators first.',
      ])
      expect(process.exitCode).toBe(1)
      expect(commands).toEqual([])
    } finally {
      process.exitCode = previousExitCode ?? 0
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('rejects an uninstalled system image before deleting', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-uninstalled-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const installedSystemImage = 'system-images;android-35;google_apis_playstore;arm64-v8a'
    const previousExitCode = process.exitCode
    const cancellations: string[] = []

    try {
      await installSystemImage(sdkRoot, installedSystemImage)

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages: ['system-images/android-36/google_apis_playstore/arm64-v8a'],
        },
        {
          cancel: (message) => cancellations.push(message),
          getHomeDirectory: () => homeDirectory,
          intro: () => {},
          runInteractiveCommand: async () => {
            throw new Error('Unexpected system image uninstall.')
          },
        },
      )

      expect(cancellations).toEqual([
        `Error: System image is not installed: system-images;android-36;google_apis_playstore;arm64-v8a\nInstalled system images:\n- ${installedSystemImage}\nList them with: solana-mobile emulator images list`,
      ])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('selects installed system images before deleting when images are omitted', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-select-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const sdkmanager = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'sdkmanager')
    const systemImages = [
      'system-images;android-35;google_apis_playstore;arm64-v8a',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ]
    const commands: Array<[string, ...string[]]> = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '22.0')

      for (const systemImage of systemImages) {
        await installSystemImage(sdkRoot, systemImage)
      }

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages: [],
        },
        {
          getHomeDirectory: () => homeDirectory,
          log: () => {},
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          runMultiselect: async (options) => {
            expect(options.message).toBe('Select system images to delete')
            expect(options.options.map((option) => option.label)).toEqual([
              'system-images/android-35/google_apis_playstore/arm64-v8a',
              'system-images/android-36/google_apis_playstore/arm64-v8a',
            ])
            expect(options.options.map((option) => option.value)).toEqual(systemImages)
            expect(options.required).toBe(false)
            return [systemImages[1] as string]
          },
          taskLog: () => ({
            error: () => {},
            group: () => ({ error: () => {}, message: () => {}, success: () => {} }),
            message: () => {},
            success: () => {},
          }),
        },
      )

      expect(commands).toEqual([[sdkmanager, '--uninstall', systemImages[1] as string]])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('deletes system images with raw interactive output when verbose', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-system-image-delete-verbose-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const sdkmanager = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'sdkmanager')
    const systemImage = 'system-images;android-35;google_apis_playstore;arm64-v8a'
    const commands: Array<[string, ...string[]]> = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '22.0')
      await installSystemImage(sdkRoot, systemImage)

      await runEmulatorImagesDelete(
        {
          sdkRoot,
          systemImages: [systemImage],
          verbose: true,
        },
        {
          getHomeDirectory: () => homeDirectory,
          log: () => {},
          runCommand: async () => {
            throw new Error('Unexpected non-interactive uninstall.')
          },
          runInteractiveCommand: async (cmd) => {
            commands.push(cmd)
          },
          taskLog: () => {
            throw new Error('Unexpected uninstall taskLog.')
          },
        },
      )

      expect(commands).toEqual([[sdkmanager, '--uninstall', systemImage]])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('parses modern and legacy system image package output', () => {
    expect(
      parseSystemImagePackages(`
Installed packages:
  system-images/android-35/google_apis_playstore/arm64-v8a  9.0.0  Google Play ARM 64 v8a System Image
Available Packages:
  system-images;android-34;google_apis_playstore;arm64-v8a | 14 | Google Play ARM 64 v8a System Image
  system-images/android-36/google_apis_playstore/arm64-v8a  7.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.1/google_apis_playstore_ps16k/arm64-v8a  7.0.0  16 KB Page Size Google Play ARM 64 v8a System Image
`),
    ).toEqual([
      'system-images;android-34;google_apis_playstore;arm64-v8a',
      'system-images;android-35;google_apis_playstore;arm64-v8a',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
      'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
    ])
  })

  test('filters compatible Google Play images newest first', () => {
    expect(
      filterCompatibleSystemImages(
        [
          'system-images;android-36;google_apis_playstore;x86_64',
          'system-images;android-35;google_apis_playstore;arm64-v8a',
          'system-images;android-36.1;google_apis_playstore;arm64-v8a',
          'system-images;android-37;google_apis;arm64-v8a',
          'system-images;android-37.1;google_apis_playstore;arm64-v8a',
          'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
        ],
        'arm64',
      ),
    ).toEqual([
      'system-images;android-37.1;google_apis_playstore;arm64-v8a',
      'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a',
      'system-images;android-36.1;google_apis_playstore;arm64-v8a',
      'system-images;android-35;google_apis_playstore;arm64-v8a',
    ])
  })

  test('filters system images for one Android platform', () => {
    expect(
      filterSystemImagesForPlatform(
        [
          'system-images;android-36.1;google_apis_playstore;arm64-v8a',
          'system-images;android-37.0;google_apis_playstore;arm64-v8a',
          'system-images;android-37.0-ext2;google_apis_playstore;arm64-v8a',
          'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
          'system-images;android-38;google_apis_playstore;arm64-v8a',
        ],
        'android-37.0',
      ),
    ).toEqual([
      'system-images;android-37.0;google_apis_playstore;arm64-v8a',
      'system-images;android-37.0-ext2;google_apis_playstore;arm64-v8a',
      'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
    ])
  })

  test('selects and installs an available image with the Android CLI', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-android-')
    const android = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'android')
    const commands: Array<[string, ...string[]]> = []
    const intros: string[] = []
    const logs: string[] = []
    const selectedSystemImage = 'system-images;android-37.0-ext2;google_apis_playstore;arm64-v8a'
    const spinnerEvents: string[] = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')
      await installAndroidPlatform(sdkRoot, 'android-36.1')
      await installAndroidPlatform(sdkRoot, 'android-37.0')

      await runEmulatorImagesInstall(
        { sdkRoot },
        {
          architecture: 'arm64',
          intro: (message) => intros.push(message),
          log: (message) => logs.push(message),
          runCommand: async (cmd) => {
            commands.push(cmd)

            if (cmd[2] === 'install') {
              return ''
            }

            return `
Available packages:
  system-images/android-36.1/google_apis_playstore/arm64-v8a  4.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0/google_apis_playstore/arm64-v8a  7.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0-ext2/google_apis_playstore/arm64-v8a  1.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0/google_apis_playstore_ps16k/arm64-v8a  7.0.0  16 KB Page Size Google Play ARM 64 v8a System Image
  system-images/android-38/google_apis_playstore/arm64-v8a  1.0.0  Google Play ARM 64 v8a System Image
`
          },
          runInteractiveCommand: async () => {
            throw new Error('Unexpected interactive install.')
          },
          runSelect: async (options) => {
            expect(options.initialValue).toBe(selectedSystemImage)
            expect(options.message).toBe('Select a system image to install')
            expect(options.options.map((option) => option.value)).toEqual([
              selectedSystemImage,
              'system-images;android-37.0;google_apis_playstore;arm64-v8a',
              'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
            ])
            expect(options.options.map((option) => option.label)).toEqual([
              'system-images/android-37.0-ext2/google_apis_playstore/arm64-v8a',
              'system-images/android-37.0/google_apis_playstore/arm64-v8a',
              'system-images/android-37.0/google_apis_playstore_ps16k/arm64-v8a (16 KB page size)',
            ])
            return selectedSystemImage
          },
          spinner: () => ({
            cancel: (message) => spinnerEvents.push(`cancel:${message}`),
            clear: () => {},
            error: (message) => spinnerEvents.push(`error:${message}`),
            isCancelled: false,
            message: () => {},
            start: (message) => spinnerEvents.push(`start:${message}`),
            stop: (message) => spinnerEvents.push(`stop:${message}`),
          }),
          taskLog: () => {
            throw new Error('Unexpected taskLog in non-verbose mode.')
          },
        },
      )

      expect(commands).toEqual([
        [android, 'sdk', 'list', '--all', 'system-images/*/google_apis_playstore*/*'],
        [android, 'sdk', 'install', 'system-images/android-37.0-ext2/google_apis_playstore/arm64-v8a'],
      ])
      expect(intros).toEqual(['solana-mobile emulator images install'])
      expect(logs).toEqual([`Installed system image: ${selectedSystemImage}`])
      expect(spinnerEvents).toEqual([
        'start:Fetching available system images',
        'stop:Fetched available system images',
        'start:Installing Android system image',
        'stop:Installed Android system image',
      ])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('selects from all compatible images when requested', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-all-')
    const android = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'android')
    const installs: Array<[string, ...string[]]> = []
    const selectedSystemImage = 'system-images;android-36.1;google_apis_playstore;arm64-v8a'

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')

      await runEmulatorImagesInstall(
        { all: true, sdkRoot, verbose: true },
        {
          architecture: 'arm64',
          intro: () => {},
          log: () => {},
          runCommand: async () => `
Available packages:
  system-images/android-35/google_apis_playstore_ps16k/arm64-v8a  7.0.0  16 KB Page Size Google Play ARM 64 v8a System Image
  system-images/android-36.1/google_apis_playstore/arm64-v8a  4.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0/google_apis_playstore/x86_64  7.0.0  Google Play Intel x86_64 Atom System Image
  system-images/android-38/google_apis_playstore/arm64-v8a  1.0.0  Google Play ARM 64 v8a System Image
`,
          runInteractiveCommand: async (cmd) => {
            installs.push(cmd)
          },
          runSelect: async (options) => {
            expect(options.initialValue).toBe('system-images;android-38;google_apis_playstore;arm64-v8a')
            expect(options.options.map((option) => option.value)).toEqual([
              'system-images;android-38;google_apis_playstore;arm64-v8a',
              selectedSystemImage,
              'system-images;android-35;google_apis_playstore_ps16k;arm64-v8a',
            ])
            return selectedSystemImage
          },
        },
      )

      expect(installs).toEqual([
        [android, 'sdk', 'install', 'system-images/android-36.1/google_apis_playstore/arm64-v8a'],
      ])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('reports when no Android platforms are installed before selecting an image', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-no-platforms-')
    const logs: string[] = []

    try {
      await runEmulatorImagesInstall(
        { sdkRoot },
        {
          architecture: 'arm64',
          intro: () => {},
          log: (message) => logs.push(message),
          runCommand: async () => {
            throw new Error('Unexpected system image listing.')
          },
          runInteractiveCommand: async () => {
            throw new Error('Unexpected system image install.')
          },
          runSelect: async () => {
            throw new Error('Unexpected system image prompt.')
          },
        },
      )

      expect(logs).toEqual(['No Android SDK platforms are installed.'])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('reports when no images match the latest installed Android platform', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-no-platform-match-')
    const logs: string[] = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')
      await installAndroidPlatform(sdkRoot, 'android-37.0')

      await runEmulatorImagesInstall(
        { sdkRoot },
        {
          architecture: 'arm64',
          intro: () => {},
          log: (message) => logs.push(message),
          runCommand: async () =>
            '  system-images/android-36.1/google_apis_playstore/arm64-v8a  4.0.0  Google Play ARM 64 v8a System Image\n',
          runInteractiveCommand: async () => {
            throw new Error('Unexpected system image install.')
          },
          runSelect: async () => {
            throw new Error('Unexpected system image prompt.')
          },
        },
      )

      expect(logs).toEqual(['No system images are available to install for android-37.0.'])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('installs an explicit image with sdkmanager fallback', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-sdkmanager-')
    const sdkmanager = join(sdkRoot, 'cmdline-tools', '20.0', 'bin', 'sdkmanager')
    const commands: Array<[string, ...string[]]> = []
    const installs: Array<[string, ...string[]]> = []
    const systemImage = 'system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a'

    try {
      await installAndroidCommandLineTool(sdkRoot, 'sdkmanager', '20.0')

      await runEmulatorImagesInstall(
        {
          sdkRoot,
          systemImage: 'system-images/android-37.1/google_apis_playstore_ps16k/arm64-v8a',
          verbose: true,
        },
        {
          architecture: 'arm64',
          log: () => {},
          runCommand: async (cmd) => {
            commands.push(cmd)
            return `  ${systemImage} | 9 | Google Play ARM 64 v8a System Image\n`
          },
          runInteractiveCommand: async (cmd) => {
            installs.push(cmd)
          },
          runSelect: async () => {
            throw new Error('Unexpected system image prompt.')
          },
          taskLog: ({ title }) => {
            if (title !== 'Fetching available system images') {
              throw new Error('Unexpected install taskLog.')
            }

            return {
              error: () => {},
              group: () => ({ error: () => {}, message: () => {}, success: () => {} }),
              message: () => {},
              success: () => {},
            }
          },
        },
      )

      expect(commands).toEqual([[sdkmanager, '--list']])
      expect(installs).toEqual([[sdkmanager, '--install', systemImage]])
    } finally {
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('rejects an unavailable image with compatible options', async () => {
    const sdkRoot = await createTemporaryDirectory('solana-mobile-system-image-install-unavailable-')
    const previousExitCode = process.exitCode
    const cancellations: string[] = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')

      await runEmulatorImagesInstall(
        {
          sdkRoot,
          systemImage: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        },
        {
          architecture: 'arm64',
          cancel: (message) => cancellations.push(message),
          runCommand: async () =>
            `  system-images/android-35/google_apis_playstore/arm64-v8a  9.0.0  Google Play ARM 64 v8a System Image\n`,
          runInteractiveCommand: async () => {
            throw new Error('Unexpected system image install.')
          },
        },
      )

      expect(cancellations).toEqual([
        'Error: System image is not available: system-images;android-36;google_apis_playstore;arm64-v8a\nAvailable system images:\n- system-images/android-35/google_apis_playstore/arm64-v8a',
      ])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode ?? 0
      await rm(sdkRoot, { force: true, recursive: true })
    }
  })

  test('creates an emulator and writes the expected config shape', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const olderSystemImage = 'system-images;android-35;google_apis_playstore;arm64-v8a'
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const commands: Array<{ cmd: [string, ...string[]]; stdin?: string }> = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'avdmanager', '22.0')
      await installSystemImage(sdkRoot, olderSystemImage)
      await installSystemImage(sdkRoot, systemImage)

      const result = await createAvd(
        {
          device: 'pixel_9',
          name: 'test_phone',
          sdkRoot,
        },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd, options = {}) => {
            commands.push({ cmd, stdin: options.stdin })

            if (cmd[0].endsWith('avdmanager')) {
              await mkdir(join(homeDirectory, '.android', 'avd', 'test_phone.avd'), { recursive: true })
              await writeFile(join(homeDirectory, '.android', 'avd', 'test_phone.ini'), 'path=test_phone.avd\n')
              await writeFile(join(homeDirectory, '.android', 'avd', 'test_phone.avd', 'config.ini'), 'legacy=1\n')
            }

            return ''
          },
        },
      )
      const config = parseAvdConfig(
        await readFile(join(homeDirectory, '.android', 'avd', 'test_phone.avd', 'config.ini'), 'utf8'),
      )

      expect(commands).toEqual([
        {
          cmd: [
            join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'avdmanager'),
            'create',
            'avd',
            '--abi',
            'arm64-v8a',
            '--device',
            'pixel_9',
            '--force',
            '--name',
            'test_phone',
            '--package',
            systemImage,
            '--sdcard',
            '512M',
          ],
          stdin: 'no\n',
        },
      ])
      expect(config).toMatchObject({
        'abi.type': 'arm64-v8a',
        'avd.ini.displayname': 'test phone',
        'disk.dataPartition.size': '32G',
        'hw.device.name': 'pixel_9',
        'hw.ramSize': '8192',
        'image.sysdir.1': 'system-images/android-36/google_apis_playstore/arm64-v8a/',
        legacy: '1',
        'sdcard.size': '512M',
        target: 'android-36',
      })
      expect(result).toEqual({
        created: true,
        emulatorPath: join(sdkRoot, 'emulator', 'emulator'),
        name: 'test_phone',
        sdkRoot,
        systemImage,
      })
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('skips creating when the emulator already exists', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-existing-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const configPath = join(homeDirectory, '.android', 'avd', 'existing_phone.avd', 'config.ini')
    const commands: Array<{ cmd: [string, ...string[]]; stdin?: string }> = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'existing_phone.avd'), { recursive: true })
      await writeFile(configPath, 'legacy=1\n')

      const result = await createAvd(
        {
          device: 'pixel_9',
          name: 'existing_phone',
          sdkRoot,
          systemImage,
        },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd, options = {}) => {
            commands.push({ cmd, stdin: options.stdin })
            return ''
          },
        },
      )

      expect(commands).toEqual([])
      expect(await readFile(configPath, 'utf8')).toBe('legacy=1\n')
      expect(result).toEqual({
        created: false,
        emulatorPath: join(sdkRoot, 'emulator', 'emulator'),
        name: 'existing_phone',
        sdkRoot,
        systemImage,
      })
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('prompts for emulator name before creating when name is omitted', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-prompt-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const commands: Array<{ cmd: [string, ...string[]]; stdin?: string }> = []
    const intros: string[] = []
    const logs: string[] = []
    const consoleLog = spyOn(console, 'log').mockImplementation((message) => logs.push(String(message)))

    try {
      await installAndroidCommandLineTool(sdkRoot, 'avdmanager')
      await installSystemImage(sdkRoot, systemImage)

      await runEmulatorCreate(
        {
          sdkRoot,
          systemImage,
        },
        {
          getHomeDirectory: () => homeDirectory,
          intro: (message) => intros.push(message),
          runCommand: async (cmd, options = {}) => {
            commands.push({ cmd, stdin: options.stdin })

            if (cmd[0].endsWith('avdmanager')) {
              await mkdir(join(homeDirectory, '.android', 'avd', 'prompted_phone.avd'), { recursive: true })
              await writeFile(join(homeDirectory, '.android', 'avd', 'prompted_phone.ini'), 'path=prompted_phone.avd\n')
            }

            return ''
          },
          runText: async (options) => {
            expect(options.defaultValue).toBe('solana-mobile')
            expect(options.initialValue).toBe('solana-mobile')
            expect(options.message).toBe('Emulator name')
            return 'prompted_phone'
          },
        },
      )

      expect(intros).toEqual(['solana-mobile emulator create'])
      expect(logs).not.toContain('Preparing emulator: prompted_phone')
      expect(commands).toEqual([
        {
          cmd: [
            join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
            'create',
            'avd',
            '--abi',
            'arm64-v8a',
            '--device',
            'pixel_9_pro_xl',
            '--force',
            '--name',
            'prompted_phone',
            '--package',
            systemImage,
            '--sdcard',
            '512M',
          ],
          stdin: 'no\n',
        },
      ])
    } finally {
      consoleLog.mockRestore()
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('installs a selected system image before creating when none are installed', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-install-image-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const android = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'android')
    const avdmanager = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'avdmanager')
    const commands: Array<{ cmd: [string, ...string[]]; stdin?: string }> = []
    const installs: Array<[string, ...string[]]> = []
    const intros: string[] = []
    const spinnerEvents: string[] = []
    const systemImage = 'system-images;android-37.0;google_apis_playstore;arm64-v8a'

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')
      await installAndroidCommandLineTool(sdkRoot, 'avdmanager', '22.0')
      await installAndroidPlatform(sdkRoot, 'android-37.0')

      await runEmulatorCreate(
        {
          name: 'installed_phone',
          sdkRoot,
        },
        {
          architecture: 'arm64',
          getHomeDirectory: () => homeDirectory,
          intro: (message) => intros.push(message),
          log: () => {},
          runCommand: async (cmd, options = {}) => {
            commands.push({ cmd, stdin: options.stdin })

            if (cmd[0] === android && cmd[2] === 'install') {
              installs.push(cmd)
              await installSystemImage(sdkRoot, systemImage)
              return ''
            }

            if (cmd[0] === android && cmd[2] === 'list') {
              return `
Available packages:
  system-images/android-36.1/google_apis_playstore/arm64-v8a  4.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0/google_apis_playstore/arm64-v8a  7.0.0  Google Play ARM 64 v8a System Image
  system-images/android-37.0/google_apis_playstore_ps16k/arm64-v8a  7.0.0  16 KB Page Size Google Play ARM 64 v8a System Image
`
            }

            if (cmd[0] === avdmanager) {
              await mkdir(join(homeDirectory, '.android', 'avd', 'installed_phone.avd'), { recursive: true })
              await writeFile(
                join(homeDirectory, '.android', 'avd', 'installed_phone.ini'),
                'path=installed_phone.avd\n',
              )
              return ''
            }

            throw new Error(`Unexpected command: ${cmd.join(' ')}`)
          },
          runInteractiveCommand: async () => {
            throw new Error('Unexpected interactive install.')
          },
          runSelect: async (options) => {
            expect(options.initialValue).toBe(systemImage)
            expect(options.message).toBe('Select a system image to install')
            expect(options.options.map((option) => option.value)).toEqual([
              systemImage,
              'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
            ])
            return systemImage
          },
          spinner: () => ({
            cancel: (message) => spinnerEvents.push(`cancel:${message}`),
            clear: () => {},
            error: (message) => spinnerEvents.push(`error:${message}`),
            isCancelled: false,
            message: () => {},
            start: (message) => spinnerEvents.push(`start:${message}`),
            stop: (message) => spinnerEvents.push(`stop:${message}`),
          }),
          taskLog: () => {
            throw new Error('Unexpected taskLog in non-verbose mode.')
          },
        },
      )

      expect(commands).toEqual([
        {
          cmd: [android, 'sdk', 'list', '--all', 'system-images/*/google_apis_playstore*/*'],
          stdin: undefined,
        },
        {
          cmd: [android, 'sdk', 'install', 'system-images/android-37.0/google_apis_playstore/arm64-v8a'],
          stdin: undefined,
        },
        {
          cmd: [
            avdmanager,
            'create',
            'avd',
            '--abi',
            'arm64-v8a',
            '--device',
            'pixel_9_pro_xl',
            '--force',
            '--name',
            'installed_phone',
            '--package',
            systemImage,
            '--sdcard',
            '512M',
          ],
          stdin: 'no\n',
        },
      ])
      expect(installs).toEqual([
        [android, 'sdk', 'install', 'system-images/android-37.0/google_apis_playstore/arm64-v8a'],
      ])
      expect(intros).toEqual(['solana-mobile emulator create'])
      expect(spinnerEvents).toEqual([
        'start:Fetching available system images',
        'stop:Fetched available system images',
        'start:Installing Android system image',
        'stop:Installed Android system image',
      ])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('shows system image installation output when creating with verbose output', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-install-image-verbose-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const android = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'android')
    const avdmanager = join(sdkRoot, 'cmdline-tools', '22.0', 'bin', 'avdmanager')
    const installs: Array<[string, ...string[]]> = []
    const systemImage = 'system-images;android-37.0;google_apis_playstore;arm64-v8a'

    try {
      await installAndroidCommandLineTool(sdkRoot, 'android', '22.0')
      await installAndroidCommandLineTool(sdkRoot, 'avdmanager', '22.0')
      await installAndroidPlatform(sdkRoot, 'android-37.0')

      await runEmulatorCreate(
        {
          name: 'verbose_phone',
          sdkRoot,
          verbose: true,
        },
        {
          architecture: 'arm64',
          getHomeDirectory: () => homeDirectory,
          intro: () => {},
          log: () => {},
          runCommand: async (cmd) => {
            if (cmd[0] === android) {
              return `  ${systemImage} | 7 | Google Play ARM 64 v8a System Image\n`
            }

            if (cmd[0] === avdmanager) {
              await mkdir(join(homeDirectory, '.android', 'avd', 'verbose_phone.avd'), { recursive: true })
              return ''
            }

            throw new Error(`Unexpected command: ${cmd.join(' ')}`)
          },
          runInteractiveCommand: async (cmd) => {
            installs.push(cmd)
            await installSystemImage(sdkRoot, systemImage)
          },
          runSelect: async () => systemImage,
          taskLog: ({ title }) => {
            if (title !== 'Fetching available system images') {
              throw new Error('Unexpected install taskLog.')
            }

            return {
              error: () => {},
              group: () => ({ error: () => {}, message: () => {}, success: () => {} }),
              message: () => {},
              success: () => {},
            }
          },
        },
      )

      expect(installs).toEqual([
        [android, 'sdk', 'install', 'system-images/android-37.0/google_apis_playstore/arm64-v8a'],
      ])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('creates without prompting when emulator name is provided', async () => {
    const rootDirectory = await createTemporaryDirectory('solana-mobile-avd-create-named-')
    const homeDirectory = join(rootDirectory, 'home')
    const sdkRoot = join(rootDirectory, 'sdk')
    const systemImage = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const commands: Array<[string, ...string[]]> = []
    const taskTitles: string[] = []

    try {
      await installAndroidCommandLineTool(sdkRoot, 'avdmanager')
      await installSystemImage(sdkRoot, systemImage)

      await runEmulatorCreate(
        {
          name: 'named_phone',
          sdkRoot,
          systemImage,
        },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd) => {
            commands.push(cmd)

            if (cmd[0].endsWith('avdmanager')) {
              await mkdir(join(homeDirectory, '.android', 'avd', 'named_phone.avd'), { recursive: true })
              await writeFile(join(homeDirectory, '.android', 'avd', 'named_phone.ini'), 'path=named_phone.avd\n')
            }

            return ''
          },
          runText: async () => {
            throw new Error('Unexpected emulator name prompt.')
          },
          tasks: async (list) => {
            for (const task of list) {
              taskTitles.push(task.title)
              const result = await task.task(() => {})
              expect(result).toBe('Created emulator: named_phone')
            }
          },
        },
      )

      expect(commands.map((command) => command.join(' '))).toContain(
        `${join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager')} create avd --abi arm64-v8a --device pixel_9_pro_xl --force --name named_phone --package ${systemImage} --sdcard 512M`,
      )
      expect(taskTitles).toEqual(['Creating emulator: named_phone'])
    } finally {
      await rm(rootDirectory, { force: true, recursive: true })
    }
  })

  test('rejects --tune without --start when creating an emulator', async () => {
    const cancels: string[] = []
    const previousExitCode = process.exitCode

    try {
      await runEmulatorCreate(
        { name: 'named_phone', tune: true },
        {
          cancel: (message) => {
            cancels.push(message)
          },
          runCommand: async (cmd) => {
            throw new Error(`Unexpected command: ${cmd.join(' ')}`)
          },
          runText: async () => {
            throw new Error('Unexpected emulator name prompt.')
          },
          tasks: async () => {
            throw new Error('Unexpected create task.')
          },
        },
      )

      expect(cancels).toEqual([
        [
          'Error: Cannot tune an emulator that is not started: --tune requires --start',
          `Tune it later with: ${formatCliCommand('emulator tune')}`,
        ].join('\n'),
      ])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode
    }
  })

  test('deletes installed emulators through avdmanager', async () => {
    const commands: Array<[string, ...string[]]> = []

    await deleteInstalledAvds(['Alpha', 'Beta'], '/sdk', {
      runCommand: async (cmd) => {
        commands.push(cmd)
        return ''
      },
    })

    expect(commands).toEqual([
      ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Alpha'],
      ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Beta'],
    ])
  })

  test('refuses to delete a running emulator with an invocation-aware stop command', async () => {
    const previousExitCode = process.exitCode
    const commands: Array<[string, ...string[]]> = []
    const cancellations: string[] = []

    try {
      await runEmulatorDelete(
        {
          names: ['Alpha'],
          sdkRoot: '/sdk',
        },
        {
          cancel: (message) => cancellations.push(message),
          formatCommand: (command) => `npx solana-mobile ${command}`,
          runCommand: async (cmd) => {
            commands.push(cmd)

            if (cmd.join(' ') === 'adb devices') {
              return 'List of devices attached\nemulator-5554 device\n'
            }

            if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
              return 'Alpha\nOK\n'
            }

            throw new Error(`Unexpected command: ${cmd.join(' ')}`)
          },
        },
      )

      expect(cancellations).toEqual([
        'Error: Cannot delete running emulator: Alpha (emulator-5554)\nStop it first with: npx solana-mobile emulator stop Alpha',
      ])
      expect(process.exitCode).toBe(1)
      expect(commands).toEqual([
        ['adb', 'devices'],
        ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ])
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
  })

  test('selects installed emulators before deleting when names are omitted', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-delete-select-')
    const commands: Array<[string, ...string[]]> = []
    const taskTitles: string[] = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await mkdir(join(homeDirectory, '.android', 'avd', 'Beta.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Beta.ini'), 'path=Beta.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'), 'target=android-36\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Beta.avd', 'config.ini'), 'target=android-35\n')

      await runEmulatorDelete(
        {
          names: [],
          sdkRoot: '/sdk',
        },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          runMultiselect: async (options) => {
            expect(options.options.map((option) => option.value)).toEqual(['Alpha', 'Beta'])
            return ['Beta']
          },
          tasks: async (list) => {
            for (const task of list) {
              taskTitles.push(task.title)
              const result = await task.task(() => {})
              expect(result).toBe('Deleted emulator: Beta')
            }
          },
        },
      )

      expect(commands).toEqual([
        ['adb', 'devices'],
        ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Beta'],
      ])
      expect(taskTitles).toEqual(['Deleting Beta'])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('skips delete selection when no emulators are installed', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-delete-empty-')
    const commands: Array<[string, ...string[]]> = []

    try {
      await runEmulatorDelete(
        {
          names: [],
          sdkRoot: '/sdk',
        },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          runMultiselect: async () => {
            throw new Error('Unexpected delete selection prompt.')
          },
        },
      )

      expect(commands).toEqual([])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('lists running emulators from adb', async () => {
    const running = await listRunningEmulators({
      runCommand: async (cmd) => {
        if (cmd.join(' ') === 'adb devices') {
          return 'List of devices attached\nemulator-5556 device\nemulator-5554 device\nphone-1 device\n'
        }

        if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
          return 'Beta\nOK\n'
        }

        if (cmd.join(' ') === 'adb -s emulator-5556 emu avd name') {
          return 'Alpha\n'
        }

        throw new Error(`Unexpected command: ${cmd.join(' ')}`)
      },
    })

    expect(running).toEqual([
      { name: 'Alpha', serial: 'emulator-5556' },
      { name: 'Beta', serial: 'emulator-5554' },
    ])
  })

  test('lists emulator statuses from installed AVDs and adb state', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-status-')

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await mkdir(join(homeDirectory, '.android', 'avd', 'Beta.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Beta.ini'), 'path=Beta.avd\n')
      await writeFile(
        join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'),
        'hw.device.name=pixel_9\ntarget=android-36\n',
      )
      await writeFile(
        join(homeDirectory, '.android', 'avd', 'Beta.avd', 'config.ini'),
        'hw.device.name=pixel_8\ntarget=android-35\n',
      )

      const statuses = await listEmulatorStatuses({
        getHomeDirectory: () => homeDirectory,
        runCommand: async (cmd) => {
          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
            return 'Alpha\nOK\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop sys.boot_completed') {
            return '1\n'
          }

          throw new Error(`Unexpected command: ${cmd.join(' ')}`)
        },
      })

      expect(statuses).toEqual([
        {
          booted: 'yes',
          device: 'pixel_9',
          name: 'Alpha',
          serial: 'emulator-5554',
          state: 'online',
          target: 'android-36',
        },
        {
          booted: 'no',
          device: 'pixel_8',
          name: 'Beta',
          serial: undefined,
          state: 'offline',
          target: 'android-35',
        },
      ])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('lists running emulator status when it is not installed locally', async () => {
    const statuses = await listEmulatorStatuses({
      getHomeDirectory: () => '/missing-home',
      runCommand: async (cmd) => {
        if (cmd.join(' ') === 'adb devices') {
          return 'List of devices attached\nemulator-5554 device\n'
        }

        if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
          return 'Ghost\n'
        }

        if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop sys.boot_completed') {
          return '0\n'
        }

        throw new Error(`Unexpected command: ${cmd.join(' ')}`)
      },
    })

    expect(statuses).toEqual([
      {
        booted: 'no',
        name: 'Ghost',
        serial: 'emulator-5554',
        state: 'online',
      },
    ])
  })

  test('starts an installed emulator', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-start-')
    const startedCommands: Array<[string, ...string[]]> = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'), 'target=android-36\n')

      await startEmulator(
        { name: 'Alpha', sdkRoot: '/sdk' },
        {
          getHomeDirectory: () => homeDirectory,
          startProcess: async (cmd) => {
            startedCommands.push(cmd)
          },
        },
      )

      expect(startedCommands).toEqual([['/sdk/emulator/emulator', '@Alpha']])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('selects an installed emulator before starting when name is omitted', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-start-select-')
    const startedCommands: Array<[string, ...string[]]> = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await mkdir(join(homeDirectory, '.android', 'avd', 'Beta.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Beta.ini'), 'path=Beta.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'), 'target=android-36\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Beta.avd', 'config.ini'), 'target=android-35\n')

      await runEmulatorStart(
        { sdkRoot: '/sdk' },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd) => {
            throw new Error(`Unexpected command: ${cmd.join(' ')}`)
          },
          runSelect: async (options) => {
            expect(options.options.map((option) => option.value)).toEqual(['Alpha', 'Beta'])
            return 'Beta'
          },
          startProcess: async (cmd) => {
            startedCommands.push(cmd)
          },
        },
      )

      expect(startedCommands).toEqual([['/sdk/emulator/emulator', '@Beta']])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('skips start selection when no emulators are installed', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-start-empty-')
    const startedCommands: Array<[string, ...string[]]> = []

    try {
      await runEmulatorStart(
        { sdkRoot: '/sdk' },
        {
          getHomeDirectory: () => homeDirectory,
          runSelect: async () => {
            throw new Error('Unexpected start selection prompt.')
          },
          startProcess: async (cmd) => {
            startedCommands.push(cmd)
          },
        },
      )

      expect(startedCommands).toEqual([])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  // Single source for the adb commands the tweak registry issues, in registry order.
  function expectedTweakCommands(serial: string): Array<[string, ...string[]]> {
    const shell = (...args: string[]): [string, ...string[]] => ['adb', '-s', serial, 'shell', ...args]

    return [
      shell('settings', 'put', 'global', 'animator_duration_scale', '0'),
      shell('settings', 'put', 'global', 'transition_animation_scale', '0'),
      shell('settings', 'put', 'global', 'window_animation_scale', '0'),
      shell('settings', 'put', 'secure', 'autofill_service', 'null'),
      shell('pm', 'grant', 'com.android.chrome', 'android.permission.POST_NOTIFICATIONS'),
      shell('appops', 'set', 'com.android.chrome', 'POST_NOTIFICATION', 'ignore'),
      shell(
        'echo',
        'chrome --disable-fre --no-default-browser-check --no-first-run --disable-features=AndroidTipsNotifications,EducationalTipModule,InterestFeedV2,MagicStackAndroid --enable-features=FeedHeaderRemoval,HomeButtonRemoval:apply_to_all_countries/true/remove_home_button_everywhere/true',
        '>',
        '/data/local/tmp/chrome-command-line',
      ),
      shell('am', 'set-debug-app', '--persistent', 'com.android.chrome'),
      shell('settings', 'put', 'system', 'haptic_feedback_enabled', '0'),
      shell('settings', 'put', 'system', 'sound_effects_enabled', '0'),
      shell('locksettings', 'set-disabled', 'true'),
      shell('settings', 'put', 'global', 'device_provisioned', '1'),
      shell('settings', 'put', 'secure', 'user_setup_complete', '1'),
      shell('settings', 'put', 'global', 'stay_on_while_plugged_in', '7'),
      shell('settings', 'put', 'system', 'screen_off_timeout', '1800000'),
      shell('settings', 'put', 'secure', 'stylus_handwriting_education_shown', '1'),
      shell('settings', 'put', 'secure', 'stylus_handwriting_enabled', '0'),
      shell('appops', 'set', 'android', 'POST_NOTIFICATION', 'ignore'),
      shell('appops', 'set', 'com.android.vending', 'POST_NOTIFICATION', 'ignore'),
      shell('appops', 'set', 'com.google.android.gms', 'POST_NOTIFICATION', 'ignore'),
    ]
  }

  test('waits for boot and tunes after starting an emulator', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-start-tune-')
    const commands: Array<[string, ...string[]]> = []
    const startedCommands: Array<[string, ...string[]]> = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'), 'target=android-36\n')

      await runEmulatorStart(
        { name: 'Alpha', sdkRoot: '/sdk', tune: true },
        {
          getHomeDirectory: () => homeDirectory,
          runCommand: async (cmd) => {
            commands.push(cmd)

            if (cmd.join(' ') === 'adb devices') {
              return 'List of devices attached\nemulator-5554 device\n'
            }

            if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
              return 'Alpha\n'
            }

            if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop sys.boot_completed') {
              return '1\n'
            }

            if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop ro.boot.qemu') {
              return '1\n'
            }

            return ''
          },
          runSelect: async () => {
            throw new Error('Unexpected start selection prompt.')
          },
          sleep: async () => {},
          startProcess: async (cmd) => {
            startedCommands.push(cmd)
          },
        },
      )

      expect(startedCommands).toEqual([['/sdk/emulator/emulator', '@Alpha']])
      expect(commands).toEqual([
        ['adb', 'devices'],
        ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
        ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed'],
        ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.boot.qemu'],
        ...expectedTweakCommands('emulator-5554'),
      ])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('skips tuning after starting an emulator unless requested', async () => {
    const homeDirectory = await createTemporaryDirectory('solana-mobile-avd-start-no-tune-')
    const commands: Array<[string, ...string[]]> = []
    const notes: Array<[string, string | undefined]> = []
    const startedCommands: Array<[string, ...string[]]> = []

    try {
      await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.ini'), 'path=Alpha.avd\n')
      await writeFile(join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'), 'target=android-36\n')

      await runEmulatorStart(
        { name: 'Alpha', sdkRoot: '/sdk' },
        {
          getHomeDirectory: () => homeDirectory,
          note: (message, title) => {
            notes.push([message, title])
          },
          runCommand: async (cmd) => {
            commands.push(cmd)
            return ''
          },
          runSelect: async () => {
            throw new Error('Unexpected start selection prompt.')
          },
          sleep: async () => {},
          startProcess: async (cmd) => {
            startedCommands.push(cmd)
          },
        },
      )

      expect(startedCommands).toEqual([['/sdk/emulator/emulator', '@Alpha']])
      expect(commands).toEqual([])
      expect(notes).toEqual([[formatCliCommand('emulator tune Alpha'), 'Apply agent-friendly tweaks']])
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })

  test('tunes a running emulator by name', async () => {
    const commands: Array<[string, ...string[]]> = []

    const tuned = await tuneEmulator(
      'Alpha',
      {},
      {
        runCommand: async (cmd: [string, ...string[]]) => {
          commands.push(cmd)

          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
            return 'Alpha\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop ro.boot.qemu') {
            return '1\n'
          }

          return ''
        },
      },
    )

    expect(commands).toEqual([
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.boot.qemu'],
      ...expectedTweakCommands('emulator-5554'),
    ])
    expect(tuned.emulator).toEqual({ name: 'Alpha', serial: 'emulator-5554' })
    expect(tuned.applied.map((tweak) => tweak.name)).toEqual([
      'animations-off',
      'autofill-off',
      'chrome-notifications-off',
      'chrome-quiet',
      'keyboard-feedback-off',
      'lockscreen-off',
      'provisioning-complete',
      'screen-awake',
      'stylus-handwriting',
      'system-notifications-off',
    ])
    expect(tuned.skipped).toEqual([])
  })

  test('refuses to tune a target without emulator properties', async () => {
    const commands: Array<[string, ...string[]]> = []

    await expect(
      applyEmulatorTweaks(
        'emulator-5554',
        {},
        {
          runCommand: async (cmd: [string, ...string[]]) => {
            commands.push(cmd)
            return ''
          },
        },
      ),
    ).rejects.toThrow('Refusing to tune emulator-5554')

    expect(commands).toEqual([
      ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.boot.qemu'],
      ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.kernel.qemu'],
    ])
  })

  test('tunes without prompting for tweaks with --yes', async () => {
    const cancelMessages: string[] = []
    const commands: Array<[string, ...string[]]> = []

    await runEmulatorTune(
      { nameOrSerial: 'Alpha', yes: true },
      {
        cancel: (message) => {
          cancelMessages.push(message)
        },
        runCommand: async (cmd) => {
          commands.push(cmd)

          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
            return 'Alpha\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop ro.boot.qemu') {
            return '1\n'
          }

          return ''
        },
        runMultiselect: async () => {
          throw new Error('The tweak picker must not open with --yes')
        },
      },
    )

    expect(cancelMessages).toEqual([])
    expect(commands).toEqual([
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.boot.qemu'],
      ...expectedTweakCommands('emulator-5554'),
    ])
  })

  test('selects a running emulator before tuning when name or serial is omitted', async () => {
    const cancelMessages: string[] = []
    const commands: Array<[string, ...string[]]> = []

    await runEmulatorTune(
      {},
      {
        cancel: (message) => {
          cancelMessages.push(message)
        },
        runCommand: async (cmd) => {
          commands.push(cmd)

          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
            return 'Alpha\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 shell getprop ro.boot.qemu') {
            return '1\n'
          }

          return ''
        },
        runMultiselect: async ({ initialValues }: { initialValues?: string[] }) => initialValues ?? [],
        runSelect: async (options) => {
          expect(options.message).toEqual('Select a running emulator to tune')
          expect(options.options).toEqual([{ hint: 'serial: emulator-5554', label: 'Alpha', value: 'emulator-5554' }])
          return 'emulator-5554'
        },
      },
    )

    expect(cancelMessages).toEqual([])
    expect(commands).toEqual([
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5554', 'shell', 'getprop', 'ro.boot.qemu'],
      ...expectedTweakCommands('emulator-5554'),
    ])
  })

  test('fails when the emulator does not boot within the timeout', async () => {
    const sleepDurations: number[] = []

    await expect(
      waitForEmulatorBoot('Alpha', {
        pollIntervalMs: 10,
        runCommand: async () => 'List of devices attached\n',
        sleep: async (milliseconds) => {
          sleepDurations.push(milliseconds)
        },
        timeoutMs: 30,
      }),
    ).rejects.toThrow('Emulator did not boot within')

    expect(sleepDurations).toEqual([10, 10, 10])
  })

  test('sleeps the remaining duration when the timeout is not divisible by the interval', async () => {
    const sleepDurations: number[] = []

    await expect(
      waitForEmulatorBoot('Alpha', {
        pollIntervalMs: 10,
        runCommand: async () => 'List of devices attached\n',
        sleep: async (milliseconds) => {
          sleepDurations.push(milliseconds)
        },
        timeoutMs: 25,
      }),
    ).rejects.toThrow('Emulator did not boot within')

    expect(sleepDurations).toEqual([10, 10, 5])
  })

  test('rejects an ambiguous emulator name while waiting for boot', async () => {
    await expect(
      waitForEmulatorBoot('Alpha', {
        runCommand: async (cmd) => {
          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\nemulator-5556 device\n'
          }

          return 'Alpha\n'
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow('Multiple running emulators match Alpha. Tune by serial instead.')
  })

  test('rejects invalid boot polling durations', async () => {
    await expect(
      waitForEmulatorBoot('Alpha', {
        pollIntervalMs: 0,
        runCommand: async () => 'List of devices attached\n',
      }),
    ).rejects.toThrow('pollIntervalMs must be a positive number: 0')

    await expect(
      waitForEmulatorBoot('Alpha', {
        runCommand: async () => 'List of devices attached\n',
        timeoutMs: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow('timeoutMs must be a non-negative number: Infinity')
  })

  test('stops a running emulator by name', async () => {
    const commands: Array<[string, ...string[]]> = []

    const stopped = await stopEmulator('Alpha', {
      runCommand: async (cmd) => {
        commands.push(cmd)

        if (cmd.join(' ') === 'adb devices') {
          return 'List of devices attached\nemulator-5554 device\n'
        }

        if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
          return 'Alpha\n'
        }

        return ''
      },
    })

    expect(commands).toEqual([
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5554', 'emu', 'kill'],
    ])
    expect(stopped).toEqual({ name: 'Alpha', serial: 'emulator-5554' })
  })

  test('selects a running emulator before stopping when name or serial is omitted', async () => {
    const commands: Array<[string, ...string[]]> = []

    await runEmulatorStop(
      {},
      {
        runCommand: async (cmd) => {
          commands.push(cmd)

          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\nemulator-5554 device\nemulator-5556 device\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5554 emu avd name') {
            return 'Alpha\n'
          }

          if (cmd.join(' ') === 'adb -s emulator-5556 emu avd name') {
            return 'Beta\n'
          }

          return ''
        },
        runSelect: async (options) => {
          expect(options.options).toEqual([
            { hint: 'serial: emulator-5554', label: 'Alpha', value: 'emulator-5554' },
            { hint: 'serial: emulator-5556', label: 'Beta', value: 'emulator-5556' },
          ])
          return 'emulator-5556'
        },
      },
    )

    expect(commands).toEqual([
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5556', 'emu', 'avd', 'name'],
      ['adb', 'devices'],
      ['adb', '-s', 'emulator-5554', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5556', 'emu', 'avd', 'name'],
      ['adb', '-s', 'emulator-5556', 'emu', 'kill'],
    ])
  })

  test('skips stop selection when no emulators are running', async () => {
    const commands: Array<[string, ...string[]]> = []

    await runEmulatorStop(
      {},
      {
        runCommand: async (cmd) => {
          commands.push(cmd)

          if (cmd.join(' ') === 'adb devices') {
            return 'List of devices attached\n'
          }

          throw new Error(`Unexpected command: ${cmd.join(' ')}`)
        },
        runSelect: async () => {
          throw new Error('Unexpected stop selection prompt.')
        },
      },
    )

    expect(commands).toEqual([['adb', 'devices']])
  })
})
