import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Task } from "@libclank/agent"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, Triggers, createScheduler } from "@libclank/core"
import { createConsoleObserver, createPiEndpoint, fileOutput, jsonFileOutput, logListeningTriggers, openFile } from "@libclank/local"

type Link = { readonly url: string; readonly title: string; readonly reason: string }
type LinkArtifact = { readonly url: string; readonly path: string }
type LinkSummary = { readonly url: string; readonly title: string; readonly summary: string }
type DigestInput = { readonly summaries: readonly LinkSummary[]; readonly path: string }
type UrlRequest = { readonly url: string; readonly path: string }

const artifactDirectory = resolve("link-digests")

const discoverLinksEndpoint = createPiEndpoint<UrlRequest, readonly Link[]>({
  prompt: ({ input }) => `Visit ${input.url} and identify the three most interesting, relevant links to follow.
Write exactly a JSON array to ${input.path}. Each item must be {"url": string, "title": string, "reason": string}.
Use tools to read the source page and write the file. Verify the file exists before finishing.`,
  output: jsonFileOutput(parseLinks),
})

const summarizeLinkEndpoint = createPiEndpoint<LinkArtifact, LinkSummary>({
  prompt: ({ input }) => `Visit ${input.url} and write a JSON summary to ${input.path}.
The file must be exactly {"url": string, "title": string, "summary": string}. Focus on the link's substantive content.
Use tools to read the URL and write the file. Verify the file exists before finishing.`,
  output: jsonFileOutput(parseLinkSummary),
})

const writeDigestEndpoint = createPiEndpoint<DigestInput, { readonly path: string }>({
  prompt: ({ input }) => `Write a Markdown synthesis of these independently researched links to ${input.path}:
${JSON.stringify(input.summaries, null, 2)}

Include a title, one section per source with its URL, and a concise cross-source conclusion. Use tools to write and verify the exact file.`,
  output: fileOutput,
})

const trigger = Triggers.webhook<UrlRequest>({
  id: Id.trigger("digest-links"),
  path: "/hooks/digest-links",
  decode: async (request) => {
    const body = await request.json() as { url?: unknown }
    if (typeof body.url !== "string") throw new Error("Expected JSON body with a url string")
    new URL(body.url)
    await mkdir(artifactDirectory, { recursive: true })
    return { url: body.url, path: artifactPath("links") }
  },
})

const discoverLinks = Task.agent<UrlRequest, readonly Link[]>({
  id: Id.node("discover-interesting-links"),
  endpoint: discoverLinksEndpoint,
  instructions: "Extract three interesting links from the supplied page.",
})

const summarizeLink = Task.agent<LinkArtifact, LinkSummary>({
  id: Id.node("summarize-link"),
  endpoint: summarizeLinkEndpoint,
  instructions: "Summarize one linked page into structured JSON.",
})

const writeDigest = Task.agent<DigestInput, { readonly path: string }>({
  id: Id.node("write-link-digest"),
  endpoint: writeDigestEndpoint,
  instructions: "Synthesize link summaries into a Markdown digest.",
})

const openDigest = openFile({ id: Id.node("open-link-digest") })

const workflow = trigger
  .then(discoverLinks)
  .map((links) => links.map((link) => ({ url: link.url, path: artifactPath("summary") })))
  .mapEach(summarizeLink)
  .map((summaries) => ({ summaries, path: artifactPath("digest", "md") }))
  .then(writeDigest)
  .tap(openDigest)

const scheduler = createScheduler({ workflows: [workflow], observer: createConsoleObserver() })
const app = createTriggerApp(scheduler)

Bun.serve({ port: 8788, fetch: app.fetch })
console.log("Local LibClank link-digest server listening on http://localhost:8788")
logListeningTriggers(scheduler.triggers)

function artifactPath(kind: string, extension = "json"): string {
  return join(artifactDirectory, `${kind}-${crypto.randomUUID()}.${extension}`)
}

function parseLinks(value: unknown): readonly Link[] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isLink)) throw new Error("Expected exactly three link objects")
  return value
}

function parseLinkSummary(value: unknown): LinkSummary {
  if (!isLinkSummary(value)) throw new Error("Expected a link summary object")
  return value
}

function isLink(value: unknown): value is Link {
  return isRecord(value) && typeof value.url === "string" && typeof value.title === "string" && typeof value.reason === "string"
}

function isLinkSummary(value: unknown): value is LinkSummary {
  return isRecord(value) && typeof value.url === "string" && typeof value.title === "string" && typeof value.summary === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null }
