import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// Short commit hash of the build, so the version badge changes on every
// deploy even if package.json's version wasn't bumped — that way "did GitHub
// Pages actually pick up my latest push?" is always answerable just by
// comparing this against `git rev-parse --short HEAD` locally. Falls back to
// "unknown" if git isn't available (e.g. a source tarball with no .git dir).
function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(getCommitHash()),
  },
});
