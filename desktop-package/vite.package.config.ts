import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  // Package builds must not load developer .env files.
  envDir: resolve(root, '.build/no-env'),
  build: { sourcemap: false },
});
