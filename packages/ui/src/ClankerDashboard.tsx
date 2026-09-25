import { BrowserRouter, NavLink, Route, Routes } from "react-router"
import { useEffect, useState, type ReactElement } from "react"
import "./clanker-dashboard.css"

type Workflow = { readonly id: string; readonly triggers: readonly { readonly id: string; readonly path?: string }[] }
type Run = { readonly runId: string; readonly workflowId: string; readonly status: string; readonly updatedAt: number }

export interface ClankerDashboardProps {
  readonly apiBase?: string
  readonly title?: string
}

/** Reusable LibClank operations console. Applications supply only their API base and title. */
export const ClankerDashboard = ({ apiBase = "/api", title = "Clanker" }: ClankerDashboardProps): ReactElement => (
  <BrowserRouter>
    <div className="clanker-shell">
      <header className="clanker-masthead">
        <NavLink className="clanker-wordmark" to="/">
          {title} / Operations
        </NavLink>
        <nav aria-label="Primary navigation">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/workflows">Workflows</NavLink>
          <NavLink to="/runs">Runs</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard apiBase={apiBase} />} />
        <Route path="/workflows" element={<Workflows apiBase={apiBase} />} />
        <Route path="/runs" element={<Runs apiBase={apiBase} />} />
      </Routes>
    </div>
  </BrowserRouter>
)

const Dashboard = ({ apiBase }: { readonly apiBase: string }) => (
  <main>
    <div className="clanker-heading">
      <p className="clanker-eyebrow">Operations / Cloudflare</p>
      <h1>Dashboard</h1>
    </div>
    <div className="clanker-grid">
      <section>
        <p className="clanker-label">01 / Workflows</p>
        <Workflows apiBase={apiBase} compact />
      </section>
      <section>
        <p className="clanker-label">02 / Recent runs</p>
        <Runs apiBase={apiBase} compact />
      </section>
    </div>
  </main>
)

const Workflows = ({ apiBase, compact = false }: { readonly apiBase: string; readonly compact?: boolean }) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  useEffect(() => {
    void fetch(`${apiBase}/workflows`)
      .then((response) => response.json())
      .then((value) => setWorkflows(value as Workflow[]))
  }, [apiBase])
  return (
    <main className={compact ? "clanker-compact" : ""}>
      {!compact && (
        <div className="clanker-heading">
          <p className="clanker-eyebrow">Operations / Definitions</p>
          <h1>Workflows</h1>
        </div>
      )}
      <div>
        {workflows.map((workflow) => (
          <article className="clanker-workflow" key={workflow.id}>
            <span>{workflow.id}</span>
            <code>{workflow.triggers.map((trigger) => trigger.path ?? trigger.id).join(" · ")}</code>
          </article>
        ))}
        {workflows.length === 0 && <p className="clanker-muted">No workflows registered.</p>}
      </div>
    </main>
  )
}

const Runs = ({ apiBase, compact = false }: { readonly apiBase: string; readonly compact?: boolean }) => {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => {
    const load = () =>
      void fetch(`${apiBase}/runs`)
        .then((response) => response.json())
        .then((value) => setRuns(value as Run[]))
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [apiBase])
  return (
    <main className={compact ? "clanker-compact" : ""}>
      {!compact && (
        <div className="clanker-heading">
          <p className="clanker-eyebrow">Operations / History</p>
          <h1>Runs</h1>
        </div>
      )}
      <div>
        {runs.map((run) => (
          <article className="clanker-run" key={run.runId}>
            <span className={`clanker-status clanker-status-${run.status}`}>{run.status}</span>
            <span>{run.workflowId}</span>
            <time>{new Date(run.updatedAt).toLocaleString()}</time>
          </article>
        ))}
        {runs.length === 0 && <p className="clanker-muted">No runs yet.</p>}
      </div>
    </main>
  )
}
