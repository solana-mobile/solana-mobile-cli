export type {
  TemplateMetadata,
  TemplateRepository,
  TemplateRepositoryArtifact,
  TemplateRepositoryCheckResult,
  TemplateRepositoryGroup,
} from './data-access/template-repository.ts'
export { checkTemplateRepository, renderTemplateRepository } from './data-access/template-repository.ts'
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
