import { Effect, Schema } from "effect"
import { Id, Task, type Task as TaskNode } from "@libclank/core"

const Identifier = Schema.Union([Schema.String, Schema.Number])
const MergeRequestWebhook = Schema.Struct({
  object_attributes: Schema.optional(
    Schema.Struct({
      iid: Schema.optional(Schema.Number),
      action: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
    }),
  ),
  project: Schema.optional(Schema.Struct({ id: Identifier })),
  project_id: Schema.optional(Identifier),
  merge_request: Schema.optional(Schema.Struct({ iid: Schema.optional(Schema.Number) })),
})

const GitLabMergeRequest = Schema.Struct({
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.String),
})

const GitLabChanges = Schema.Struct({
  changes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        old_path: Schema.optional(Schema.String),
        new_path: Schema.optional(Schema.String),
        diff: Schema.optional(Schema.String),
      }),
    ),
  ),
})

type MergeRequestWebhook = Schema.Schema.Type<typeof MergeRequestWebhook>
type GitLabMergeRequest = Schema.Schema.Type<typeof GitLabMergeRequest>
type GitLabChanges = Schema.Schema.Type<typeof GitLabChanges>

export interface MergeRequestEvent {
  readonly projectId: string
  readonly mergeRequestIid: number
  readonly action: string
  readonly title?: string
  readonly source?: unknown
}

export interface MergeRequestContext extends MergeRequestEvent {
  readonly title: string
  readonly description: string
  readonly diff: string
  readonly changedFiles: readonly string[]
}

export interface GitLabReview {
  readonly summary: string
  readonly findings: readonly {
    readonly file?: string
    readonly line?: number
    readonly severity: "info" | "warning" | "error"
    readonly message: string
  }[]
}

export const decodeMergeRequestWebhook = async (request: Request): Promise<MergeRequestEvent> => {
  const body: MergeRequestWebhook = await Schema.decodeUnknownPromise(MergeRequestWebhook)(await request.json())
  const projectId = body.project?.id ?? body.project_id
  const iid = body.object_attributes?.iid ?? body.merge_request?.iid
  if (projectId === undefined || iid === undefined) throw new Error("Invalid GitLab merge request payload")
  return {
    projectId: String(projectId),
    mergeRequestIid: iid,
    action: body.object_attributes?.action ?? "update",
    ...(body.object_attributes?.title === undefined ? {} : { title: body.object_attributes.title }),
  }
}

export interface GitLabOptions {
  readonly baseUrl: string
  readonly token: string
  readonly projectId?: string
}

export const createGitLabTasks = (options: GitLabOptions) => {
  const request = async <S extends Schema.ConstraintDecoder<unknown, never>>(
    path: string,
    schema: S,
    init?: RequestInit,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/api/v4${path}`, {
      ...init,
      headers: { "content-type": "application/json", "private-token": options.token, ...init?.headers },
    })
    if (!response.ok) throw new Error(`GitLab API ${response.status}: ${await response.text()}`)
    return await Schema.decodeUnknownPromise(schema)(await response.json())
  }

  const listOpenMergeRequests: TaskNode<void, MergeRequestEvent[]> = Task.fn({
    id: Id.node("gitlab.list-open-merge-requests"),
    run: () =>
      Effect.tryPromise(async () => {
        if (!options.projectId) throw new Error("GitLab projectId is required to list open merge requests")
        const project = encodeURIComponent(options.projectId)
        const requests = await request(
          `${`/projects/${project}/merge_requests?state=opened&scope=all&per_page=100`}`,
          Schema.Array(GitLabMergeRequest),
        )
        return requests.map((mr) => ({
          projectId: options.projectId!,
          mergeRequestIid: mr.iid,
          action: "manual",
          title: mr.title,
        }))
      }),
  })

  const getMergeRequestContext: TaskNode<MergeRequestEvent, MergeRequestContext> = Task.fn({
    id: Id.node("gitlab.get-merge-request-context"),
    run: (event) =>
      Effect.tryPromise(async () => {
        const project = encodeURIComponent(event.projectId)
        const mr = await request(`/projects/${project}/merge_requests/${event.mergeRequestIid}`, GitLabMergeRequest)
        const changes = await request(
          `/projects/${project}/merge_requests/${event.mergeRequestIid}/changes`,
          GitLabChanges,
        )
        return {
          ...event,
          title: mr.title,
          description: mr.description ?? "",
          diff: (changes.changes ?? [])
            .map((change) => `--- ${change.old_path ?? ""}\n+++ ${change.new_path ?? ""}\n${change.diff ?? ""}`)
            .join("\n"),
          changedFiles: (changes.changes ?? []).map((change) => change.new_path ?? change.old_path ?? ""),
        }
      }),
  })

  const createReviewComment: TaskNode<{ event: MergeRequestEvent; review: GitLabReview }, void> = Task.effect({
    id: Id.node("gitlab.post-review"),
    run: ({ event, review }) =>
      Effect.tryPromise(async () => {
        const project = encodeURIComponent(event.projectId)
        await request(`/projects/${project}/merge_requests/${event.mergeRequestIid}/notes`, Schema.Unknown, {
          method: "POST",
          body: JSON.stringify({ body: formatReview(review) }),
        })
      }),
  })

  return { listOpenMergeRequests, getMergeRequestContext, createReviewComment }
}

function formatReview(review: GitLabReview): string {
  const findings =
    review.findings.length === 0
      ? "No findings."
      : review.findings
          .map(
            (finding) => `- **${finding.severity}**${finding.file ? ` \`${finding.file}\`` : ""}: ${finding.message}`,
          )
          .join("\n")
  return `## libclank review\n\n${review.summary}\n\n${findings}`
}
