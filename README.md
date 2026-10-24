# Chinaready MCP Server

[![Chinaready China Market-Entry Search MCP connector – tool definition quality and endpoint health on Glama](https://glama.ai/mcp/connectors/co.chinaready/search/badges/score.svg)](https://glama.ai/mcp/connectors/co.chinaready/search)

[![Listed on ClaudePluginHub](https://www.claudepluginhub.com/badge/chinaready-chinaready)](https://www.claudepluginhub.com/plugins/chinaready-chinaready?ref=badge)

<a href="https://www.producthunt.com/products/chinaready-mcp?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-chinaready-mcp"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1281511&amp;theme=dark"><img alt="Chinaready MCP - Let your AI cite real sources on China market entry | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1281511&amp;theme=light"></picture></a>

Remote MCP server for **[chinaready.co](https://chinaready.co)** — the practical guide for Western SaaS, app, and game teams entering Mainland China. Ask about ICP filing and licensing, app-store and game publishing, China cloud regions (AWS China, Azure China, Alibaba Cloud), payments, and compliance; every answer cites its source page.

- **Endpoint:** `https://mcp.chinaready.co/mcp` (Streamable HTTP, stateless)
- **Auth:** none — public, read-only content
- **Host:** any Cloudflare Workers-compatible runtime (zero dependencies, zero secrets)

## Tools

| Tool | What it does |
|---|---|
| `search` | Hybrid semantic + keyword search over the corpus; returns ranked excerpts with absolute chinaready.co URLs |
| `list_topics` | The topics the corpus covers, with example queries and hub pages |
| `get_article` | Reads any chinaready.co page as clean Markdown |

All tools are read-only (`readOnlyHint: true`).

## Install

**Claude** — claude.ai → Settings → Connectors → **Add custom connector** → paste `https://mcp.chinaready.co/mcp` → choose *No sign in* → Add.

**Claude Code**

```bash
claude mcp add --transport http chinaready https://mcp.chinaready.co/mcp
```

**Cursor** — one click:

```
https://cursor.com/en/install-mcp?name=chinaready&config=eyJ1cmwiOiJodHRwczovL21jcC5jaGluYXJlYWR5LmNvL21jcCJ9
```

**VS Code** — one click (opens the redirect installer):

```
https://insiders.vscode.dev/redirect/mcp/install?name=chinaready&config=%7B%22url%22%3A%22https%3A%2F%2Fmcp.chinaready.co%2Fmcp%22%7D
```

or in `.vscode/mcp.json`:

```json
{ "servers": { "chinaready": { "url": "https://mcp.chinaready.co/mcp" } } }
```

**Any MCP client** (Windsurf, Zed, LibreChat, …) — remote server, no command, no keys:

```json
{ "mcpServers": { "chinaready": { "url": "https://mcp.chinaready.co/mcp" } } }
```

## Development

```bash
npm install
npm test        # vitest unit tests (protocol + tools, upstream mocked)
npm run deploy  # wrangler deploy (needs your Cloudflare auth)
```

The server is a thin stateless proxy over Chinaready's public retrieval API
(`search.chinaready.co`); it stores nothing and needs no environment
variables. Outbound calls go only to `search.chinaready.co` (retrieval) and
`chinaready.co` (article fetch) — no other network destinations.
`get_article` only fetches `chinaready.co` pages it has validated
as safe site paths.

## Usage tracking

Every RPC message writes one data point to the `chinaready_mcp_usage`
Analytics Engine dataset (blobs: `method`, `tool`, `outcome`, truncated `ua`;
retention ~90 days). Method and tool names only — arguments and query content
are never logged.

```bash
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run usage        # last 7 days
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm run usage 30     # last 30 days
```

Prints the daily volume, the RPC funnel (`initialize` → `tools/list` →
`tools/call`), tool-call breakdown with error outcomes, and a client split
(sdk / probe-bot / browser) so real usage can be told apart from the MCP
directory liveness bots. The token needs *Analytics Engine Read*.

Raw queries go through the [Analytics Engine SQL
API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
(`POST /accounts/{account}/analytics_engine/sql`):

```sql
SELECT blob2 AS tool, sum(_sample_interval) AS hits
FROM chinaready_mcp_usage
WHERE timestamp > now() - INTERVAL '7' DAY AND blob1 = 'tools/call'
GROUP BY tool ORDER BY hits DESC
```

## License

[MIT](./LICENSE)
