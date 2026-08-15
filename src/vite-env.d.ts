/// <reference types="vite/client" />

/** package.json's `version` and the build's short git commit hash, both
 * injected at build time by vite.config.ts's `define` — shown next to the
 * app title so a deployed GitHub Pages build can be confirmed against the
 * version/commit that was pushed. */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
