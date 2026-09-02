export interface WebshellInitCommandOptions {
  applicationId?: string
  appName?: string
  directory?: string
  force?: boolean
  keystoreAlias?: string
  keystorePath?: string
  manifest?: string
  url?: string
  versionCode?: number
  versionName?: string
}

export interface WebshellBuildCommandOptions {
  directory?: string
  keystoreAlias?: string
  keystorePath?: string
  stacktrace?: boolean
}
