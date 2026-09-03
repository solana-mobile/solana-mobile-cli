import { InvalidArgumentError } from 'commander'

export function parseIntegerOption(value: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer, received: ${value}`)
  }

  return parsed
}
