import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    onlyBundle: false,
  },
  dts: true,
  entry: ['src/cli.ts', 'src/templates.ts'],
  format: ['esm', 'cjs'],
  sourcemap: true,
})
