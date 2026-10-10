# Ireland Open Data MCP

Read-only Irish public data through one remote MCP endpoint.

## Providers

- `data_gov_ie`
- `smart_dublin`
- `met_eireann`

## Tools

- `search_datasets`
- `get_dataset`
- `get_resource`

No joins, analytics, recommendations, or derived insights.

`source` selects one upstream catalogue. Harvested datasets can appear in more
than one catalogue and may have different metadata there.

Current provider configs allow `limit` values from 1 to 100. Resource metadata
lists every catalogued format. Direct retrieval supports CSV, JSON, and XML;
other direct formats return `UNSUPPORTED_FORMAT`.

## Local development

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm run dev
```

MCP endpoint: `https://ireland-open-data-mcp.ireland-open-data-mcp.workers.dev/mcp`

The checked-in configuration uses GitHub OAuth. Add the GitHub client values to
`.env` before starting locally. Authentication modes are documented in
[`docs/authentication.md`](docs/authentication.md).

## Checks

```bash
npm run typecheck
npm test
```

## Deploy

```bash
npm run deploy
```

Authentication modes are configured in `config/server.yml`.

## Runtime

- Cloudflare Workers
- TypeScript
- Stateless Streamable HTTP MCP at `/mcp`
- YAML-configured provider adapters
