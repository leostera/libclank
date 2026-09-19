import { Id, type ArtifactId } from "@libclank/core"

export type ArtifactDigest = `sha256:${string}`
export type ArtifactBody = string | Uint8Array | ArrayBuffer

export interface ArtifactRef {
  readonly id: ArtifactId
  readonly digest: ArtifactDigest
  readonly name: string
  readonly contentType: string
  readonly size: number
}

export interface PutArtifact {
  readonly name: string
  readonly contentType: string
  readonly body: ArtifactBody
}

/** Immutable content-addressed artifact operations. */
export interface Artifacts {
  put(artifact: PutArtifact): Promise<ArtifactRef>
  get(ref: ArtifactRef): Promise<Uint8Array>
  has(digest: ArtifactDigest): Promise<boolean>
}

export const Artifacts = {
  digest: async (body: ArtifactBody): Promise<ArtifactDigest> => {
    const hash = await crypto.subtle.digest("SHA-256", bytes(body) as unknown as BufferSource)
    return `sha256:${toHex(new Uint8Array(hash))}`
  },

  ref: async (artifact: PutArtifact): Promise<ArtifactRef> => {
    const body = bytes(artifact.body)
    const digest = await Artifacts.digest(body)
    return {
      id: Id.artifact(digest),
      digest,
      name: artifact.name,
      contentType: artifact.contentType,
      size: body.byteLength,
    }
  },

  bytes,
}

function bytes(body: ArtifactBody): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body)
  return body instanceof ArrayBuffer ? new Uint8Array(body) : body
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
