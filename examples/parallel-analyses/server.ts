import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Task } from "@libclank/agent"
import { createTriggerApp } from "@libclank/cloudflare"
import { Id, Triggers } from "@libclank/core"
import {
  createConsoleObserver,
  createLocalSchedulerDatabase,
  createLocalSchedulerOperations,
  createPiEndpoint,
  fileOutput,
  logListeningTriggers,
  openFile,
} from "@libclank/local"
import { createDurableScheduler } from "@libclank/scheduler"
import { createDashboardApi, createDashboardAssetHandler } from "@libclank/ui"

type SourceRequest = { readonly url: string; readonly path: string }
type MarkdownArtifact = { readonly url: string; readonly path: string }
type AnalysisArtifact = { readonly path: string }

const artifactDirectory = resolve("parallel-analysis-artifacts")

const fetchContentEndpoint = createPiEndpoint<SourceRequest, SourceRequest>({
  prompt: ({
    input,
  }) => `Fetch ${input.url}, extract its substantive contents as Markdown, and write it exactly to ${input.path}.
Do not summarize or analyze it yet. Use tools to fetch and write the file, then verify the exact path exists.`,
  output: fileOutput,
})

const analysisEndpoint = (kind: "topic" | "style" | "confidence", instructions: string) =>
  createPiEndpoint<MarkdownArtifact, AnalysisArtifact>({
    prompt: ({ input }) => {
      const outputPath = analysisPath(input.path, kind)
      return `Read the Markdown source at ${input.path}, which came from ${input.url}.
${instructions}
Write the analysis as Markdown exactly to ${outputPath}. Use tools to read, write, and verify the output file.`
    },
    output: async (input) => {
      const path = analysisPath(input.path, kind)
      await fileOutput({ path })
      return { path }
    },
  })

const trigger = Triggers.webhook<SourceRequest>({
  id: Id.trigger("analyze-url"),
  path: "/hooks/analyze-url",
  decode: async (request) => {
    const body = (await request.json()) as { url?: unknown }
    if (typeof body.url !== "string") throw new Error("Expected JSON body with a url string")
    new URL(body.url)
    await mkdir(artifactDirectory, { recursive: true })
    return { url: body.url, path: artifactPath("source") }
  },
})

const fetchContent = Task.agent<SourceRequest, MarkdownArtifact>({
  id: Id.node("fetch-url-markdown"),
  endpoint: fetchContentEndpoint,
  instructions: "Fetch a URL and save its Markdown source.",
})

const analyzeTopic = Task.agent<MarkdownArtifact, AnalysisArtifact>({
  id: Id.node("analyze-topic"),
  endpoint: analysisEndpoint("topic", "Identify the most interesting topic or argument and explain why it matters."),
  instructions: "Analyze the most interesting topic.",
})

const analyzeStyle = Task.agent<MarkdownArtifact, AnalysisArtifact>({
  id: Id.node("analyze-writing-style"),
  endpoint: analysisEndpoint(
    "style",
    "Analyze the writing style: structure, tone, clarity, rhetorical choices, and intended audience.",
  ),
  instructions: "Analyze writing style.",
})

const analyzeConfidence = Task.agent<MarkdownArtifact, AnalysisArtifact>({
  id: Id.node("analyze-author-confidence"),
  endpoint: analysisEndpoint(
    "confidence",
    "Assess how confident a reader should be that the author knows what they are discussing. Cite evidence, uncertainty, and limitations.",
  ),
  instructions: "Analyze author expertise and confidence.",
})

const openAnalysis = openFile({ id: Id.node("open-analysis") })

const workflow = trigger.then(fetchContent).fanout({
  topic: analyzeTopic.tap(openAnalysis),
  style: analyzeStyle.tap(openAnalysis),
  confidence: analyzeConfidence.tap(openAnalysis),
})

const database = createLocalSchedulerDatabase()
const scheduler = await createDurableScheduler({ workflows: [workflow], database, observer: createConsoleObserver() })
const app = createTriggerApp(scheduler)
const operations = {
  ...createLocalSchedulerOperations(database),
  trigger: (triggerId: string, input: unknown) => scheduler.runTrigger(Id.trigger(triggerId), input),
}
app.route("/api", createDashboardApi(operations))
const dashboardAssets = createDashboardAssetHandler()
app.get("/*", (context) => dashboardAssets(context.req.raw))

Bun.serve({ port: 8789, fetch: app.fetch })
console.log("Local LibClank parallel-analysis server listening on http://localhost:8789")
console.log("Dashboard and API available at http://localhost:8789/")
logListeningTriggers(scheduler.triggers)

function artifactPath(kind: string): string {
  return join(artifactDirectory, `${kind}-${crypto.randomUUID()}.md`)
}

function analysisPath(sourcePath: string, kind: string): string {
  return sourcePath.replace(/\.md$/, `.${kind}.md`)
}
