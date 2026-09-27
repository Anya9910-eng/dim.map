import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/testing/setupEnv.ts"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
