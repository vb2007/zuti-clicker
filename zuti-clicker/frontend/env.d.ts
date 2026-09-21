/// <reference types="vite/client" />

// Both variables are baked in at Docker build time (frontend/Dockerfile's
// ARG/ENV pair) - there is no runtime env for this static-nginx image. See
// src/lib/api.ts (VITE_API_BASE_URL) and src/utils/featureFlags.ts
// (VITE_ENABLE_QUICK_RESET).
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_QUICK_RESET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// A build-time `define` (vite.config.ts / vitest.config.ts), not a runtime
// env var — baked into the bundle from package.json's "version" at build
// time, same as the two ImportMetaEnv fields above.
declare const __APP_VERSION__: string;
