import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { SourceMetadata } from "@libclank/scheduler"

const exec = promisify(execFile)

/** Best-effort Git metadata for local workflow registration. */
export const discoverLocalSourceMetadata = async (
  options: { readonly repository?: string; readonly packagePath?: string } = {},
): Promise<SourceMetadata> => {
  const deployedAt = Date.now()
  try {
    const [{ stdout: commitSha }, { stdout: branch }, { stdout: status }] = await Promise.all([
      exec("git", ["rev-parse", "HEAD"]),
      exec("git", ["branch", "--show-current"]),
      exec("git", ["status", "--porcelain"]),
    ])
    return {
      ...options,
      commitSha: commitSha.trim(),
      ...(branch.trim() ? { branch: branch.trim() } : {}),
      dirty: status.trim().length > 0,
      deployedAt,
    }
  } catch {
    return { ...options, deployedAt }
  }
}
