export type {
  TemplateSyncAction,
  TemplateSyncActionKind,
  TemplateSyncDependencies,
  TemplateSyncPlan,
  TrackedFile,
} from './data-access/sync-template-repository.ts'
export { applyTemplateSync, listWorkTreeChanges, planTemplateSync } from './data-access/sync-template-repository.ts'
export type {
  TemplateMetadata,
  TemplateRepository,
  TemplateRepositoryArtifact,
  TemplateRepositoryCheckResult,
  TemplateRepositoryGroup,
  TemplateRepositoryWriteResult,
} from './data-access/template-repository.ts'
export {
  checkTemplateRepository,
  renderTemplateRepository,
  writeTemplateRepository,
} from './data-access/template-repository.ts'
export type {
  TemplateGroupConfig,
  TemplatePackageJson,
  TemplateRepositoryPackageJson,
} from './data-access/template-repository-schema.ts'
export {
  TemplateGroupConfigSchema,
  TemplatePackageJsonSchema,
  TemplateRepositoryPackageJsonSchema,
} from './data-access/template-repository-schema.ts'
export { runTemplatesCheck, type TemplatesCheckCommandOptions } from './templates-feature-check.ts'
export { runTemplatesGenerate, type TemplatesGenerateCommandOptions } from './templates-feature-generate.ts'
export { runTemplatesSync, type TemplatesSyncCommandOptions } from './templates-feature-sync.ts'
