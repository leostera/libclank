import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Task } from "@libclank/agent"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, Triggers, createScheduler } from "@libclank/core"
import { createConsoleObserver, createPiEndpoint, fileOutput, logListeningTriggers } from "@libclank/local"
import { openFile } from "@libclank/local/tasks/fs/open-file"

type SummaryRequest = {
  readonly url: string
  readonly path: string
}

const summaryDirectory = resolve("summaries")
const pi = createPiEndpoint({
  prompt: (request) => {
    const input = request.input as SummaryRequest
    return `Read and summarize ${input.url}.

Write a concise Markdown summary to exactly this path:
${input.path}

Use your available tools to fetch the URL and write the file. Do not merely return the summary in chat. Before you finish, read the exact path with a tool to verify that the Markdown file exists; the workflow will fail if it does not.

Do not open the file yourself; the following LibClank task owns that side effect.
`
  },
  output: fileOutput,
})

const summarizeUrl = Triggers.webhook<SummaryRequest>({
  id: Id.trigger("summarize-url"),
  path: "/hooks/summarize-url",
  decode: async (request) => {
    const body = await request.json() as { url?: unknown }
    if (typeof body.url !== "string") throw new Error("Expected JSON body with a url string")
    new URL(body.url)
    await mkdir(summaryDirectory, { recursive: true })
    return { url: body.url, path: join(summaryDirectory, `${crypto.randomUUID()}.md`) }
  },
})

const summarize = Task.agent<SummaryRequest, SummaryRequest>({
  id: Id.node("summarize-website"),
  endpoint: pi,
  instructions: "Summarize the requested website and write the requested Markdown artifact.",
})

const openSummary = openFile({ id: Id.node("open-summary") })

const workflow = summarizeUrl.then(summarize).tap(openSummary)
const scheduler = createScheduler({ workflows: [workflow], observer: createConsoleObserver() })
const app = createTriggerApp(scheduler)

Bun.serve({ port: 8787, fetch: app.fetch })
console.log("Local LibClank server listening on http://localhost:8787")
logListeningTriggers(scheduler.triggers)
