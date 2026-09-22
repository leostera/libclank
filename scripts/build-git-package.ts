import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const dist = join(root, "dist")
const entries = ["core", "agent", "cloudflare"] as const

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

for (const entry of entries) {
  const result = await Bun.build({
    entrypoints: [join(root, "packages", entry, "src", "index.ts")],
    outdir: dist,
    naming: `${entry}.js`,
    target: "browser",
    format: "esm",
    minify: false,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }

  const declarations = join(dist, entry)
  await cp(join(root, "packages", entry, "dist"), declarations, { recursive: true })
  await rewriteDeclarations(declarations)
}

async function rewriteDeclarations(directory: string): Promise<void> {
  const files = await Array.fromAsync(new Bun.Glob("**/*.d.ts").scan({ cwd: directory, absolute: true }))
  await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, "utf8")
      await writeFile(
        file,
        source.replaceAll('"@libclank/core"', '"libclank/core"').replaceAll('"@libclank/agent"', '"libclank/agent"'),
      )
    }),
  )
}
