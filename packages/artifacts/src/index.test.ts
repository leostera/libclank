import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLocalArtifacts } from "@libclank/local"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const local = async () => {
  const root = await mkdtemp(join(tmpdir(), "libclank-artifacts-"))
  roots.push(root)
  return createLocalArtifacts({ root })
}

describe("local artifacts", () => {
  it("uses a stable content digest and round-trips bytes", async () => {
    const artifacts = await local()
    const ref = await artifacts.put({ name: "summary.md", contentType: "text/markdown", body: "# Hello" })

    expect(ref.digest).toMatch(/^sha256:/)
    expect(ref.id).toMatch(/^clank:artifact:/)
    expect(new TextDecoder().decode(await artifacts.get(ref))).toBe("# Hello")
  })

  it("deduplicates identical content independent of artifact name", async () => {
    const artifacts = await local()
    const first = await artifacts.put({ name: "one.txt", contentType: "text/plain", body: "same" })
    const second = await artifacts.put({ name: "two.txt", contentType: "text/plain", body: "same" })

    expect(first.digest).toBe(second.digest)
    expect(await artifacts.has(first.digest)).toBe(true)
  })
})
