import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:80",
    headless: true,
  },
  // Use the e2e-specific tsconfig to avoid resolving workspace project references
  // (the main tsconfig.json references ../../lib/api-client-react which Playwright
  // cannot resolve). tsconfig.e2e.json is a flat config with only node/esnext types.
  tsconfig: "./tsconfig.e2e.json",
});
