import { createRoot } from "react-dom/client"
import { Dashboard } from "./Dashboard.js"
import { RunGraph } from "./RunGraph.js"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root")

const appRoot = createRoot(root)
const render = () => {
  const match = window.location.hash.match(/^#\/runs\/([^/]+)$/)
  appRoot.render(match ? <RunGraph runId={decodeURIComponent(match[1]!)} /> : <Dashboard />)
}
window.addEventListener("hashchange", render)
render()
