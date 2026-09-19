import { Schema } from "effect"
import { useEffect, useState } from "react"

const Run = Schema.Struct({ id: Schema.String, status: Schema.String, createdAt: Schema.Number })
type Run = Schema.Schema.Type<typeof Run>

export interface DashboardProps {
  readonly apiBase?: string
}

/** React operational dashboard. It only reads and operates on existing runs. */
export const Dashboard = ({ apiBase = "/api" }: DashboardProps) => {
  const [runs, setRuns] = useState<readonly Run[]>([])
  useEffect(() => {
    const load = async () => {
      const value: unknown = await fetch(`${apiBase}/runs`).then((response) => response.json())
      setRuns(await Schema.decodeUnknownPromise(Schema.Array(Run))(value))
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
