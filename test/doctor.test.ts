import { describe, expect, test } from 'bun:test'
import { checkAdbVersion, parseAdbVersion } from '../src/doctor/data-access/check-adb-version.ts'
import { checkAndroidDevices, parseAdbDevices } from '../src/doctor/data-access/check-android-devices.ts'
import {
  checkSdkLicenses,
  parseAndroidApiLevels,
  parseEmulatorVersion,
  parseSdkLicenseStatus,
  resolveAndroidSdk,
  selectHighestBuildToolsVersion,
} from '../src/doctor/data-access/check-android-sdk.ts'
import { parseJavaVersion } from '../src/doctor/data-access/check-java.ts'
import { checkNodeVersion, normalizeNodeVersion } from '../src/doctor/data-access/check-node-version.ts'
import { checkOperatingSystem, checkPackageManagers } from '../src/doctor/data-access/check-system-and-javascript.ts'
import type { DoctorCheckResult } from '../src/doctor/data-access/doctor-check-result.ts'
import { type DoctorEnvironment, expandHome } from '../src/doctor/data-access/doctor-environment.ts'
import { buildDoctorReport, deriveCapabilities, getDoctorExitCode } from '../src/doctor/doctor-feature-index.ts'
import { formatDoctorReport } from '../src/doctor/ui/doctor-ui-report.ts'

function environment(overrides: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    architecture: 'arm64',
    environment: {},
    getDiskSpace: async () => 30 * 1024 ** 3,
    getHomeDirectory: () => '/home/test',
    getPlatform: () => 'linux',
    getRelease: () => '6.0',
    listDirectory: async () => [],
    pathExists: async () => false,
    resolvePath: async (path) => path,
    runCommand: async (command) => ({ path: command, stderr: '', stdout: '' }),
    ...overrides,
  }
}

describe('version parsing', () => {
  test('parses adb platform-tools version', () =>
    expect(parseAdbVersion('Android Debug Bridge version 1.0.41\nVersion 36.0.0-13206524\n')).toBe('36.0.0'))
  test('parses Android API levels', () =>
    expect(parseAndroidApiLevels(['android-35', 'preview', 'android-34'])).toEqual(['34', '35']))
  test('parses emulator version', () =>
    expect(parseEmulatorVersion('Android emulator version 36.1.9.0')).toBe('36.1.9.0'))
  test('parses Java 17 stderr format', () =>
    expect(parseJavaVersion('openjdk version "17.0.12" 2024-07-16')).toBe('17.0.12'))
  test('parses Java 21 stderr format', () =>
    expect(parseJavaVersion('java version "21.0.7" 2025-04-15 LTS')).toBe('21.0.7'))
  test('selects highest Build Tools version semantically', () =>
    expect(selectHighestBuildToolsVersion(['9.0.0', '35.0.0', '36.0.0'])).toBe('36.0.0'))
})

describe('checkNodeVersion', () => {
  test('fails below Node.js 22', () => expect(checkNodeVersion('v21.7.3').status).toBe('fail'))
  test('normalizes leading v', () => expect(normalizeNodeVersion('v22.12.0')).toBe('22.12.0'))
  test('passes Node.js 22 or higher', () => expect(checkNodeVersion('v22.12.0').status).toBe('pass'))
})

describe('checkOperatingSystem', () => {
  test.each(['darwin', 'linux', 'win32'] as const)('passes supported platform %s', (platform) => {
    expect(checkOperatingSystem(environment({ getPlatform: () => platform })).status).toBe('pass')
  })
  test('keeps an unknown platform informational', () => {
    expect(checkOperatingSystem(environment({ getPlatform: () => 'aix' })).status).toBe('info')
  })
})

describe('checkAdbVersion', () => {
  test('detects missing adb', async () => expect((await checkAdbVersion(environment())).status).toBe('fail'))
  test('passes adb 33 or higher', async () => {
    const result = await checkAdbVersion(
      environment({
        pathExists: async (path) => path.endsWith('/adb'),
        runCommand: async (path) => ({ path, stderr: '', stdout: 'Version 33.0.3-8952118' }),
      }),
      '/sdk',
    )
    expect(result.actual).toBe('33.0.3')
    expect(result.status).toBe('pass')
  })
})

describe('Android SDK resolution', () => {
  test('expands home-relative paths', () =>
    expect(expandHome('~/Android/Sdk', '/home/test')).toBe('/home/test/Android/Sdk'))
  test('uses ANDROID_HOME before ANDROID_SDK_ROOT', async () => {
    const result = await resolveAndroidSdk(
      environment({
        environment: { ANDROID_HOME: '/home-sdk', ANDROID_SDK_ROOT: '/root-sdk' },
        pathExists: async () => true,
      }),
    )
    expect(result.path).toBe('/home-sdk')
    expect(result.source).toBe('ANDROID_HOME')
  })
  test('reports conflicting environment variables', async () => {
    const result = await resolveAndroidSdk(
      environment({ environment: { ANDROID_HOME: '/one', ANDROID_SDK_ROOT: '/two' }, pathExists: async () => true }),
    )
    expect(result.conflict).toContain('conflicts')
  })
  test('uses platform fallback location', async () => {
    const result = await resolveAndroidSdk(
      environment({ pathExists: async (path) => path === '/home/test/Android/Sdk' }),
    )
    expect(result.source).toBe('default location')
  })
  test('reports missing SDK', async () => expect((await resolveAndroidSdk(environment())).path).toBeUndefined())
})

describe('SDK licenses', () => {
  test('detects accepted licenses without answering prompts', async () => {
    const result = await checkSdkLicenses(
      environment({
        runCommand: async (path) => ({ path, stderr: '', stdout: 'All SDK package licenses accepted.\n' }),
      }),
      '/sdkmanager',
    )
    expect(result.actual).toBe('all accepted')
    expect(result.status).toBe('pass')
  })
  test('detects licenses requiring acceptance', () => {
    expect(parseSdkLicenseStatus('Review licenses that have not been accepted (y/N)?')).toBe('unaccepted')
  })
  test('provides an instruction when license status cannot be checked', async () => {
    const result = await checkSdkLicenses(environment())
    expect(result.recommendation).toBe('Run: sdkmanager --licenses')
    expect(result.status).toBe('info')
  })
})

describe('package manager detection', () => {
  test('passes when one supported package manager is available', async () => {
    const result = await checkPackageManagers(
      environment({
        environment: { PATH: '/bin' },
        pathExists: async (path) => path === '/bin/npm',
        runCommand: async (path) => ({ path, stderr: '', stdout: '11.4.2' }),
      }),
    )
    expect(result.actual).toBe('npm 11.4.2')
    expect(result.status).toBe('pass')
  })
})

describe('adb devices parsing', () => {
  const devices = parseAdbDevices(
    'List of devices attached\nemulator-5554 device product:sdk model:Pixel_9\nR5CX unauthorized model:Seeker\nOFF1 offline\nOK1 device model:Seeker_2\n',
  )
  test('classifies emulator separately', () =>
    expect(devices.find(({ serial }) => serial === 'emulator-5554')?.kind).toBe('emulator'))
  test('parses authorized physical device', () =>
    expect(devices.find(({ serial }) => serial === 'OK1')?.state).toBe('device'))
  test('parses offline device', () => expect(devices.find(({ serial }) => serial === 'OFF1')?.state).toBe('offline'))
  test('parses unauthorized device', () =>
    expect(devices.find(({ serial }) => serial === 'R5CX')?.state).toBe('unauthorized'))
  test('reports no installed AVDs and no running emulator without failing', async () => {
    const checks = await checkAndroidDevices(
      environment({
        environment: { PATH: '/bin' },
        pathExists: async (path) => path === '/bin/adb',
        runCommand: async (path) => ({ path, stderr: '', stdout: 'List of devices attached\n' }),
      }),
      true,
      undefined,
      [],
    )
    expect(checks.find(({ name }) => name === 'Android emulators')?.status).toBe('warn')
    expect(checks.find(({ name }) => name === 'Running emulators')?.status).toBe('info')
  })
  test('recommends an invocation-aware command to create an emulator', async () => {
    const checks = await checkAndroidDevices(
      environment({
        environment: { npm_command: 'exec', npm_lifecycle_event: 'npx' },
        pathExists: async (path) => path === '/bin/adb',
        runCommand: async (path) => ({ path, stderr: '', stdout: 'List of devices attached\n' }),
      }),
      true,
      undefined,
      [],
    )
    expect(checks.find(({ name }) => name === 'Android emulators')?.recommendation).toBe(
      'Create one with: npx solana-mobile emulator create',
    )
  })
  test('reports unauthorized physical devices with a specific recommendation', async () => {
    const checks = await checkAndroidDevices(
      environment({
        environment: { PATH: '/bin' },
        pathExists: async (path) => path === '/bin/adb',
        runCommand: async (path) => ({ path, stderr: '', stdout: 'List of devices attached\nR5CX unauthorized\n' }),
      }),
      true,
      undefined,
      [],
    )
    const physical = checks.find(({ name }) => name === 'Physical devices')
    expect(physical?.recommendation).toContain('authorization dialog')
    expect(physical?.status).toBe('warn')
  })
  test('uses adb from the Android SDK when it is not on PATH', async () => {
    let command = ''
    await checkAndroidDevices(
      environment({
        pathExists: async (path) => path === '/sdk/platform-tools/adb',
        runCommand: async (path) => {
          command = path
          return { path, stderr: '', stdout: 'List of devices attached\n' }
        },
      }),
      true,
      '/sdk',
      [],
    )
    expect(command).toBe('/sdk/platform-tools/adb')
  })
})

describe('reports and capabilities', () => {
  const pass = (name: string): DoctorCheckResult => ({
    actual: 'ok',
    category: 'system',
    message: 'ok',
    name,
    status: 'pass',
  })
  const requiredPasses = [
    'Android SDK',
    'Android emulators',
    'Android platforms',
    'Build Tools',
    'Emulator',
    'Java',
    'Java compiler',
    'Node.js',
    'Package managers',
    'Physical devices',
    'adb',
    'avdmanager',
  ].map(pass)
  test('derives all capabilities', () =>
    expect(deriveCapabilities(requiredPasses)).toEqual({
      androidBuild: true,
      emulator: true,
      physicalDevice: true,
      projectCreation: true,
    }))
  test('deduplicates recommendations', () =>
    expect(
      buildDoctorReport([
        { ...pass('one'), recommendation: 'Fix it.', status: 'warn' },
        { ...pass('two'), recommendation: 'Fix it.', status: 'warn' },
      ]).recommendations,
    ).toEqual(['Fix it.']))
  test('failed required checks produce failure state', () =>
    expect(
      buildDoctorReport(requiredPasses.map((check) => (check.name === 'Java' ? { ...check, status: 'fail' } : check)))
        .ready,
    ).toBe(false))
  test('JSON report is valid and has no ANSI codes', () => {
    const value = JSON.stringify(buildDoctorReport(requiredPasses))
    expect(() => JSON.parse(value)).not.toThrow()
    expect(value).not.toContain(String.fromCharCode(27))
  })
  test('warning-only reports contain no failed checks', () => {
    const report = buildDoctorReport([
      { actual: 'none', category: 'device', message: 'none', name: 'Physical devices', status: 'warn' },
    ])
    expect(getDoctorExitCode(report)).toBe(0)
  })
  test('failed checks return exit code one', () =>
    expect(
      getDoctorExitCode(
        buildDoctorReport([{ actual: 'missing', category: 'java', message: 'missing', name: 'Java', status: 'fail' }]),
      ),
    ).toBe(1))
  test('renders a compact report without requirements on passing checks', () => {
    const output = formatDoctorReport(
      buildDoctorReport([
        { ...pass('Disk space'), actual: '30 GB available', category: 'system' },
        { ...pass('Node.js'), actual: '24.3.0', category: 'javascript', required: '22 or higher' },
        { ...pass('Operating system'), actual: 'macOS arm64', category: 'system' },
      ]),
    )
    expect(output).toContain('✓ Operating system  macOS arm64')
    expect(output).toContain('✓ Node.js  24.3.0')
    expect(output).not.toContain('requires 22 or higher')
    expect(output).not.toContain('│')
    expect(output.indexOf('Operating system')).toBeLessThan(output.indexOf('Disk space'))
    expect(output.indexOf('Project creation')).toBeLessThan(output.indexOf('Android build'))
  })
  test('renders requirements for failed checks and verbose details only when requested', () => {
    const report = buildDoctorReport([
      {
        actual: 'not found',
        category: 'java',
        details: ['Searched: /usr/bin'],
        message: 'missing',
        name: 'Java',
        required: '17 or higher',
        status: 'fail',
      },
    ])
    expect(formatDoctorReport(report)).not.toContain('Searched: /usr/bin')
    expect(formatDoctorReport(report, true)).toContain('Searched: /usr/bin')
    expect(formatDoctorReport(report)).toContain('not found (requires 17 or higher)')
  })
  test('labels recommendations with the check that produced them', () => {
    const report = buildDoctorReport([
      {
        actual: 'not found',
        category: 'android-sdk',
        message: 'missing',
        name: 'Android SDK',
        recommendation: 'Install the Android SDK.',
        status: 'fail',
      },
      {
        actual: 'none installed',
        category: 'emulator',
        message: 'missing',
        name: 'Android emulators',
        recommendation: 'Create an emulator.',
        status: 'warn',
      },
    ])
    const output = formatDoctorReport(report)
    expect(output).toContain('Android SDK: Install the Android SDK.')
    expect(output).toContain('Android emulators: Create an emulator.')
  })
})
