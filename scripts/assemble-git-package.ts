import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const output = join(root, "build", "git-package")
const source = join(root, "dist")
const sourcePackage = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string }

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(source, join(output, "dist"), { recursive: true })
await cp(join(root, "README.md"), join(output, "README.md"))

await writeFile(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name: "libclank",
      version: sourcePackage.version,
      private: true,
      type: "module",
      exports: {
        "./core": { types: "./dist/core/index.d.ts", default: "./dist/core.js" },
        "./agent": { types: "./dist/agent/index.d.ts", default: "./dist/agent.js" },
        "./cloudflare": { types: "./dist/cloudflare/index.d.ts", default: "./dist/cloudflare.js" },
      },
      dependencies: {
        effect: "4.0.0-rc.116",
        hono: "^4.6.14",
      },
    },
    null,
    2,
  )}\n`,
)
