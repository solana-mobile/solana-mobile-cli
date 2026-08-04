import { InitScriptSchema, initScriptKey } from 'create-solana-dapp'
import { z } from 'zod'

export const TemplateGroupConfigSchema = z.object({
  description: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
})

export const TemplatePackageJsonSchema = z.looseObject({
  [initScriptKey]: InitScriptSchema.optional(),
  description: z.string().min(1),
  displayName: z.string().optional(),
  keywords: z.array(z.string()).min(1),
  name: z.string().min(1),
  usecase: z.string().optional(),
})

export const TemplateRepositoryPackageJsonSchema = z.looseObject({
  repokit: z.object({
    groups: z.array(TemplateGroupConfigSchema).min(1),
  }),
  repository: z.looseObject({
    name: z.string().min(1),
  }),
})

export type TemplateGroupConfig = z.infer<typeof TemplateGroupConfigSchema>
export type TemplatePackageJson = z.infer<typeof TemplatePackageJsonSchema>
export type TemplateRepositoryPackageJson = z.infer<typeof TemplateRepositoryPackageJsonSchema>
