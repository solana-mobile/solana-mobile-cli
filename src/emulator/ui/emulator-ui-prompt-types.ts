import { cancel, isCancel } from '@clack/prompts'

export type MultiSelectPrompt = (options: {
  initialValues?: string[]
  message: string
  options: Array<{ hint?: string; label: string; value: string }>
  required?: boolean
}) => Promise<string[] | symbol>

export interface PromptDependencies {
  runMultiselect?: MultiSelectPrompt
  runSelect?: SelectPrompt
  runText?: TextPrompt
}

export type SelectPrompt = (options: {
  initialValue?: string
  message: string
  options: Array<{ hint?: string; label: string; value: string }>
}) => Promise<string | symbol>

export type TextPrompt = (options: {
  defaultValue?: string
  initialValue?: string
  message: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}) => Promise<string | symbol>

export function resolvePromptCancellation(value: symbol): undefined {
  if (isCancel(value)) {
    cancel('Cancelled')
    process.exitCode = 1
  }

  return undefined
}
