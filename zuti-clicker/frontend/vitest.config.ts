import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// keep in sync with vite.config.ts's own __APP_VERSION__ define
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

// Standalone from vite.config.ts: that file carries vite-plugin-vue-devtools
// and a dev-only API proxy, neither of which belongs in a test run.
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.spec.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    restoreMocks: true,
    clearMocks: true
  }
});
