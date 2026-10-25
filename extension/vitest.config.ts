import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  resolve: { conditions: ['source'] },
  test: { include: ['test/**/*.test.ts'], environment: 'happy-dom' },
});
