import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["apps/*/src/**/*.worker.test.ts"],
  },
})
