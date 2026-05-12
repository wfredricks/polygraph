import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // Type-only barrels: pure re-exports of types/values from
        // other files. Counting them as 0% covered drags the headline
        // number down without measuring anything real.
        'src/index.ts',
        'src/pure/index.ts',
        'src/proxy/index.ts',
        'src/types.ts',
        'src/proxy/types.ts',
        'src/qengine/parser/ast.ts',
        // Benchmark fixtures — not engine code.
        'src/__benchmarks__/**',
        // Test helpers — only invoked from tests, not by the engine.
        'src/__tests__/scenarios/_helpers.ts',
      ],
      thresholds: {
        // Operational gate from the daily coverage patrol. The README
        // documents the aspirational target as 95% statements / 100%
        // functions; landing those is a longer effort and tracked in
        // ROADMAP.md.
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
