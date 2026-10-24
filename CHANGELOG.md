# Changelog

All notable changes to the Chinaready MCP server are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [2.0.0] — 2026-10-24

### Added

- **`assess_china_readiness` tool** — analyzes a site manifest the calling
  agent enumerates locally (target bucket summary, build-output directory
  summary, or URL-list fallback; third-party origins with reference counts;
  optional form endpoints) and returns per-origin China-reachability verdicts
  (blocked/slow/degraded/ok/unknown) plus relative migration-effort bands
  (high/medium/low — explicitly not quotes). The server never fetches user
  URLs or bucket contents; file contents are never uploaded.
- **`submit_baseline` tool** — explicit, opt-in lead submission (email +
  site URL + assessment summary) to the Chinaready team via the new
  `POST /api/contact/mcp` site endpoint (shared-secret auth). No telemetry,
  no background transmission; nothing is sent unless invoked.
- **China-access knowledge base** (`src/data/china-access-knowledge.json`) —
  40 curated origin verdicts distilled from published chinaready.co
  insights/handbooks, with as-of date, per-origin fix guidance, and source
  article links. Updated on the site's reachability-test publication cadence;
  no live probing.

### Changed

- Version bumped to 2.0.0 (six tools; two new are additive, existing four
  unchanged). Tool-list and instructions updated.

## [1.1.0] — 2026-10-22

### Added

- **`ask` tool** — grounded DeepSeek answers over the chinaready.co corpus with
  structured citations (retrieval → generation → per-answer source URLs). (#6)
- **Distribution manifests** (#5):
  - `gemini-extension.json` — Gemini CLI extension (`httpUrl`); the gallery
    indexes tagged public repos daily.
  - `.claude-plugin/plugin.json` + `.mcp.json` — Claude Code plugin packaging
    (discovery on ClaudePluginHub).
  - `.claude-plugin/marketplace.json` — self-hosted native marketplace
    (`/plugin marketplace add chinaready/mcp`). (#8)
- **Usage telemetry** — every RPC message writes one data point to the
  `chinaready_mcp_usage` Analytics Engine dataset (method/tool/outcome/UA
  class only; arguments and query content never logged). `npm run usage`
  prints the daily volume, RPC funnel, tool breakdown, and client split. (#1, #2)
- **README badges** — Glama score (rated A, ownership verified), Product Hunt
  launch, ClaudePluginHub listing. (#8)

### Fixed

- Marketplace security review (v1.0.1): dependency CVE patch, CORS narrowed,
  `htmlToText` hardened. (#4)
- Usage script reads Analytics Engine SQL rows as named objects. (#2)

### Changed

- Plugin descriptions sharpened to lead with the hallucination problem. (#8)

## [1.0.0] — 2026-10-12

### Added

- Initial public release: stateless Cloudflare Worker implementing Streamable
  HTTP JSON-RPC directly (no SDK, no session state), MIT.
- Three read-only annotated tools: `search` (hybrid BM25 + vector over ~2,700
  chunks, absolute source URL on every result), `list_topics`, `get_article`.
- Public endpoint `https://mcp.chinaready.co/mcp` (no auth) with fallback
  retrieval API `https://search.chinaready.co/search`.
