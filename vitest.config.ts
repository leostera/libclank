import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "e2e/**/*.test.ts"],
    exclude: ["apps/*/src/**/*.worker.test.ts"],
  },
})
