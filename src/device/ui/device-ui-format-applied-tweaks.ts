import type { AppliedDeviceTweaks } from '../data-access/device-types.ts'

/** One report per tuned target, shared by `device tune` and `emulator tune` so both read the same. */
export function formatAppliedTweaks(label: string, { applied, skipped }: AppliedDeviceTweaks): string {
  return [
    `Tuned ${label}`,
    ...applied.map((tweak) => `- ${tweak.name}: ${tweak.description}`),
    ...skipped.map(({ reason, tweak }) => `- ${tweak.name}: skipped (${reason})`),
  ].join('\n')
}
