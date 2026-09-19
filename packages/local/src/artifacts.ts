import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Artifacts, type ArtifactDigest, type ArtifactRef, type Artifacts as ArtifactOperations, type PutArtifact } from "@libclank/artifacts"

export interface LocalArtifactsOptions {
  /** Defaults to `<cwd>/.clank`. */
  readonly root?: string
}

/** Content-addressed local artifacts under `.clank/artifacts/sha256`. */
export const createLocalArtifacts = (options: LocalArtifactsOptions = {}): ArtifactOperations => {
  const root = resolve(options.root ?? join(process.cwd(), ".clank"))

  return {
    async put(artifact: PutArtifact): Promise<ArtifactRef> {
      const ref = await Artifacts.ref(artifact)
      const path = contentPath(root, ref.digest)
      await mkdir(join(root, "artifacts", "sha256", digestHex(ref.digest).slice(0, 2)), { recursive: true })
      try {
        await access(path)
      } catch {
        const temporary = `${path}.${crypto.randomUUID()}.tmp`
        await writeFile(temporary, Artifacts.bytes(artifact.body))
        try { await rename(temporary, path) } catch { await writeFile(path, Artifacts.bytes(artifact.body)) }
      }
      return ref
    },

    async get(ref: ArtifactRef): Promise<Uint8Array> {
      return new Uint8Array(await readFile(contentPath(root, ref.digest)))
    },

    async has(digest: ArtifactDigest): Promise<boolean> {
      try { await access(contentPath(root, digest)); return true } catch { return false }
    },
  }
}

function contentPath(root: string, digest: ArtifactDigest): string {
  const hex = digestHex(digest)
  return join(root, "artifacts", "sha256", hex.slice(0, 2), hex.slice(2))
}

function digestHex(digest: ArtifactDigest): string { return digest.slice("sha256:".length) }
