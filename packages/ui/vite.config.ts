import { defineConfig } from "vite"

const api = process.env.LIBCLANK_API_URL ?? "http://localhost:8789"

export default defineConfig({
  server: { port: 5173, proxy: { "/api": api, "/hooks": api } },
})
