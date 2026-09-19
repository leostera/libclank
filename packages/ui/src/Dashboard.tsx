import { Schema } from "effect"
import { useEffect, useState } from "react"

const Run = Schema.Struct({ id: Schema.String, status: Schema.String, createdAt: Schema.Number })
const Workflow = Schema.Struct({
  workflowId: Schema.String,
  definitionHash: Schema.String,
  triggers: Schema.Array(Schema.Struct({ id: Schema.String, path: Schema.optional(Schema.String) })),
})
type Run = Schema.Schema.Type<typeof Run>
type Workflow = Schema.Schema.Type<typeof Workflow>

export interface DashboardProps {
  readonly apiBase?: string
}

/** React operational dashboard. It only reads and operates on existing runs. */
export const Dashboard = ({ apiBase = "/api" }: DashboardProps) => {
  const [runs, setRuns] = useState<readonly Run[]>([])
  const [workflows, setWorkflows] = useState<readonly Workflow[]>([])
  const [input, setInput] = useState("{}")
  const triggerRun = async (triggerId: string) => {
    await fetch(`${apiBase}/triggers/${encodeURIComponent(triggerId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: input,
    })
    setInput("{}")
  }
  useEffect(() => {
    const load = async () => {
      const value: unknown = await fetch(`${apiBase}/runs`).then((response) => response.json())
      setRuns(await Schema.decodeUnknownPromise(Schema.Array(Run))(value))
      const workflowValue: unknown = await fetch(`${apiBase}/workflows`).then((response) => response.json())
      setWorkflows(await Schema.decodeUnknownPromise(Schema.Array(Workflow))(workflowValue))
    }
    void load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [apiBase])
  return (
    <main>
      <header>
        <h1>LibClank</h1>
        <p>Workflow operations</p>
      </header>
      <section>
        <h2>Registered workflows</h2>
        {workflows.map((workflow) => (
          <article key={workflow.workflowId}>
            <strong>{workflow.workflowId}</strong>
            {workflow.triggers.map((triggerDef) => (
              <button key={triggerDef.id} onClick={() => triggerRun(triggerDef.id)}>
                Trigger {triggerDef.id}
              </button>
            ))}
          </article>
        ))}
        <textarea value={input} onChange={(event) => setInput(event.target.value)} aria-label="Trigger input" />
      </section>
      <section>
        <h2>Runs</h2>
        {runs.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong>{" "}
                <a href={`#/runs/${encodeURIComponent(run.id)}`}>
                  <code>{run.id}</code>
                </a>
                <time>{new Date(run.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
