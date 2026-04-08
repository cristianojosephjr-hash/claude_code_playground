# Zeus Orchestrator API

Cloudflare Worker implementation of the `open_multi_agent` coordination concept as a JSON API plus one Durable Object class, `WorkflowCoordinator`.

## Contents

- `main.mjs`: Worker entrypoint and `WorkflowCoordinator` Durable Object
- `src/workflow-state.mjs`: pure workflow graph and state transition logic
- `src/d1.mjs`: D1 row mapping and statement helpers
- `src/http.mjs`: JSON request and error helpers
- `schema.sql`: D1 schema
- `wrangler.jsonc`: Wrangler deployment config for the Worker, D1, DO, AI, and vars
- `scripts/deploy-cloudflare.mjs`: direct Cloudflare API deploy helper
- `test/workflow-state.test.mjs`: node-based tests for dependency and state logic

## Local verification

```bash
cd zeus-orchestrator-api
npm test
npm run smoke:deploy
```

## Deploy with Wrangler

This repo already has a local Wrangler OAuth login available on the machine, so the practical deployment path here is:

```bash
cd zeus-orchestrator-api
wrangler d1 create zeus-orchestrator
# update wrangler.jsonc with the returned database_id
wrangler d1 execute zeus-orchestrator --remote --file schema.sql
wrangler secret put API_TOKEN
wrangler deploy
```

## Direct Cloudflare API deploy

If you also have a valid `CLOUDFLARE_API_TOKEN`, you can use:

```bash
cd zeus-orchestrator-api
node ./scripts/deploy-cloudflare.mjs
```
