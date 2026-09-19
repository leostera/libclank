import type { ArtifactRef } from "@libclank/artifacts"

/** Durable task payload shape. Values may remain JSON while large data travels as immutable artifacts. */
export interface ArtifactBackedInput {
  readonly value?: unknown
  readonly artifacts: readonly ArtifactRef[]
}

export interface ArtifactBackedOutput {
  readonly value?: unknown
  readonly artifacts: readonly ArtifactRef[]
}

export const artifactInput = (artifacts: readonly ArtifactRef[], value?: unknown): ArtifactBackedInput => ({ artifacts, ...(value === undefined ? {} : { value }) })
export const artifactOutput = (artifacts: readonly ArtifactRef[], value?: unknown): ArtifactBackedOutput => ({ artifacts, ...(value === undefined ? {} : { value }) })
