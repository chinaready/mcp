# Usage telemetry goes to Workers Analytics Engine, never query content

The MCP server is a public, keyless endpoint whose real usage (which tools get
called, by SDK clients vs directory liveness bots) must be measurable for
weeks, but whose request bodies contain users' research questions. We record
one Analytics Engine data point per RPC message — method, tool name, outcome,
truncated user agent — and nothing else. Alternatives rejected: Workers
Logs / `console.log` (short retention, no aggregation surface) and D1
(persistence and schema churn for what is a metrics series).

## Consequences

- Retention is ~90 days; older usage is not recoverable — archive via the
  weekly SEO report if a longer series is ever needed.
- Never extend the data point with arguments, query text, or paths: the
  dataset must stay content-free by construction, not by policy. A future
  "helpful" enrichment that logs `arguments.query` is a privacy regression.
- The blob layout `[method, tool, outcome, ua]` is load-bearing — the weekly
  report collector (mvp-1 repo) queries it by position.
