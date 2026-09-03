export type {
  TemplateSyncAction,
  TemplateSyncActionKind,
  TemplateSyncDependencies,
  TemplateSyncPlan,
  TrackedFile,
} from './templates/data-access/sync-template-repository.ts'
export {
  applyTemplateSync,
  listWorkTreeChanges,
  planTemplateSync,
} from './templates/data-access/sync-template-repository.ts'
export type {
  TemplateMetadata,
  TemplateRepository,
  TemplateRepositoryArtifact,
  TemplateRepositoryCheckResult,
  TemplateRepositoryGroup,
  TemplateRepositoryWriteResult,
} from './templates/data-access/template-repository.ts'
export {
  checkTemplateRepository,
  renderTemplateRepository,
  writeTemplateRepository,
} from './templates/data-access/template-repository.ts'
export type {
  TemplateGroupConfig,
  TemplatePackageJson,
  TemplateRepositoryPackageJson,
} from './templates/data-access/template-repository-schema.ts'
export {
  TemplateGroupConfigSchema,
  TemplatePackageJsonSchema,
  TemplateRepositoryPackageJsonSchema,
} from './templates/data-access/template-repository-schema.ts'
export { runTemplatesCheck, type TemplatesCheckCommandOptions } from './templates/templates-feature-check.ts'
export { runTemplatesGenerate, type TemplatesGenerateCommandOptions } from './templates/templates-feature-generate.ts'
export { runTemplatesSync, type TemplatesSyncCommandOptions } from './templates/templates-feature-sync.ts'
