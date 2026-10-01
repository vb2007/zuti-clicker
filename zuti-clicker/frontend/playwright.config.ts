import { defineConfig, devices } from "@playwright/test";

// Port is fixed (not "next free") so the config and the webServer agree on it;
// pick a value unlikely to collide with the usual dev ports (5173 / 2710).
const PORT = Number(process.env.E2E_PORT ?? 5199);

// Locally and on the self-hosted runner a system Chromium is used rather than
// Playwright's own download (see docs/developer/final.md, "E2E tesztek").
const executablePath = process.env.CHROMIUM_PATH || undefined;

const launchOptions = { executablePath, args: ["--no-sandbox"] };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: process.env.E2E_JUNIT ?? "reports/junit-e2e.xml" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  // Each project is a device class. `touch` projects have hasTouch and a coarse
  // pointer (isMobile), so (pointer: coarse) / (hover: none) media queries match.
  projects: [
    { name: "phone-320", use: { viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true } },
    { name: "phone-375", use: { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true } },
    { name: "phone-390", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "phone-landscape", use: { viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: "desktop-wide", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 }, launchOptions } }
  ]
});
