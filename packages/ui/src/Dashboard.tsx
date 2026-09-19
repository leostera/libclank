import { useEffect, useState } from "react"
import type { WorkflowRunRecord } from "@libclank/scheduler"

export interface DashboardProps {
  readonly apiBase?: string
}

/** React operational dashboard. It only reads and operates on existing runs. */
export const Dashboard = ({ apiBase = "/api" }: DashboardProps) => {
  const [runs, setRuns] = useState<readonly WorkflowRunRecord[]>([])
  useEffect(() => {
    const load = async () =>
      setRuns(await fetch(`${apiBase}/runs`).then((response) => response.json() as Promise<WorkflowRunRecord[]>))
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
        <h2>Runs</h2>
        {runs.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong> <code>{run.id}</code>
                <time>{new Date(run.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
