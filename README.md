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

## Local development

Requires Node.js 22+.

```bash
npm install
cp .env.example .env
npm run dev
```

MCP endpoint: `http://127.0.0.1:8787/mcp`

The default `none` auth mode keeps this public-data server anonymous.

## Checks

```bash
npm run typecheck
npm test
```

## Deploy

```bash
npm run deploy
```

Authentication modes are configured in `config/server.yml`. See
[`docs/authentication.md`](docs/authentication.md) for anonymous, bearer, and
GitHub OAuth setup.

## Runtime

- Cloudflare Workers
- TypeScript
- Stateless Streamable HTTP MCP at `/mcp`
- YAML-configured provider adapters
