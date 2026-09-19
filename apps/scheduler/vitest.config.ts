import { defineConfig } from "vitest/config"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          AGENT: async (request: Request) => {
            const task = (await request.json()) as { input: unknown }
            return Response.json({ ok: true, output: task.input })
          },
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.worker.test.ts"],
  },
})
