# Local parallel analyses

A local fan-out workflow:

```text
webhook URL
  -> agent fetches source Markdown
  -> fanout in parallel
       -> topic analysis -> open file
       -> writing-style analysis -> open file
       -> author-confidence analysis -> open file
```

There is intentionally no fan-in: the three independent analysis artifacts are the terminal outputs.

```bash
bun run example:parallel-analyses

curl -X POST http://localhost:8789/hooks/analyze-url \
  -H 'content-type: application/json' \
  --data '{"url":"https://leostera.com"}'
```

Artifacts are written under `./parallel-analysis-artifacts/`.
