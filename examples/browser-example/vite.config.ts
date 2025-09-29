import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Monorepo-friendly alias so the example imports the local workspace package.
// Default: built ESM from @mero/browser (closest to published usage).
export default defineConfig({
  server: { port: 5175 },
  resolve: {
    preserveSymlinks: true, // pnpm workspaces
    alias: {
      '@mero/browser': path.resolve(
        fileURLToPath(
          new URL('../../packages/mero-browser/dist/index.js', import.meta.url)
        )
      ),

      // For live-edit (optional): point to source instead of dist.
      // '@mero/browser': path.resolve(
      //   fileURLToPath(new URL('../../packages/mero-browser/src/index.ts', import.meta.url))
      // ),
    },
  },
});
