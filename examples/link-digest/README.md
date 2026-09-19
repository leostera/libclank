# Local link digest

A local map-reduce-style LibClank workflow:

```text
webhook URL
  -> agent discovers three links
  -> mapEach: three agent summaries in parallel
  -> map: prepare a fan-in input
  -> agent writes one Markdown digest
  -> local open-file task
```

Run:

```bash
bun run example:link-digest
```

Trigger it:

```bash
curl -X POST http://localhost:8788/hooks/digest-links \
  -H 'content-type: application/json' \
  --data '{"url":"https://developers.cloudflare.com/workers/"}'
```

Intermediate agent artifacts and final Markdown output are written under `./link-digests/`.
