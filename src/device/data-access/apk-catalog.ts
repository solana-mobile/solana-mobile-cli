export interface ApkCatalogEntry {
  description: string
  name: string
  source: ApkSource
}

/** Tagged union so new source kinds (direct URLs, the dApp Store) are a new member, not a redesign. */
export type ApkSource = GithubReleaseApkSource

export interface GithubReleaseApkSource {
  asset: string
  repo: string
  /** Hex SHA-256 of the release asset; a download must match it before it enters the cache. */
  sha256: string
  tag: string
  type: 'github-release'
}

/** Known ecosystem APKs installable by name with `device install <name>`. */
export const APK_CATALOG: readonly ApkCatalogEntry[] = [
  {
    description: 'Mobile Wallet Adapter test wallet',
    name: 'fakewallet',
    source: {
      asset: 'fakewallet-v1-release.apk',
      repo: 'solana-mobile/mobile-wallet-adapter',
      sha256: '8b19cd916d30da8c4b2410a074fa59feb680cfd5292a32a4830ffd4ceb5a8ac8',
      tag: '@solana-mobile/wallet-adapter-mobile@2.2.9',
      type: 'github-release',
    },
  },
]

export function findApkCatalogEntry(name: string): ApkCatalogEntry | undefined {
  return APK_CATALOG.find((entry) => entry.name === name)
}

/**
 * Monorepo release tags contain `@` and `/`, which GitHub expects percent-encoded in the download
 * path. The catalog stores raw tags so they stay readable; encoding happens only here.
 */
export function githubReleaseDownloadUrl({ asset, repo, tag }: GithubReleaseApkSource): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`
}
