# Local URL summarizer

A local-only LibClank example:

```text
POST /hooks/summarize-url
  -> Pi reads a URL and writes Markdown to ./summaries
  -> tasks/fs/open-file.ts opens that Markdown locally
```

Start it from the repository root:

```bash
bun run example:url-summary
```

In another terminal:

```bash
curl -X POST http://localhost:8787/hooks/summarize-url \
  -H 'content-type: application/json' \
  --data '{"url":"https://developers.cloudflare.com/workers/"}'
```

Pi must already be authenticated and have permission to use the tools needed to read the URL and write the requested file. This example intentionally runs only on the local Bun runtime: it uses Pi, the local filesystem, and the OS `open`/`xdg-open` command. None of those capabilities belong in the Cloudflare Worker runtime.
