#!/usr/bin/env node
// Usage report for the chinaready-mcp worker (Analytics Engine dataset
// chinaready_mcp_usage). One data point per RPC message:
//   blob1 method, blob2 tool, blob3 outcome, blob4 ua, double1 = 1.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run usage [-- N-days]
// Defaults to the last 7 days. Needs a token with Analytics Engine Read.

const API = 'https://api.cloudflare.com/client/v4/accounts';
const DATASET = 'chinaready_mcp_usage';
const days = Number.parseInt(process.argv[2], 10) || 7;

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`${API}/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: sql,
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json();
  return { cols: payload.meta.map((m) => m.name), rows: payload.data || [] };
}

// Coarse client classes; adjust freely — the worker stores the raw UA.
function classify(ua) {
  const u = (ua || '').toLowerCase();
  if (!u) return 'empty';
  if (/probe|liveness|sentinel|mcpbeat|collector|-bot|bot\/|watch|rank|harvest|recontact|spike|taifoon|golem|histor|wellknown|toolvet|proofbench|invokerank|everymcp|rokmcp|crawler|research|factanker|ziwei/.test(u)) return 'probe/bot';
  if (/^(node|undici|python|aiohttp|httpx|go-http-client|curl)/.test(u)) return 'sdk';
  if (u.startsWith('mozilla/')) return 'browser';
  return 'other';
}

const fmt = (n) => Number(n).toLocaleString('en-US');

const { rows: daily } = await query(
  `SELECT toDateTime(intDiv(toUnixTimestamp(timestamp), 86400) * 86400) AS day, ` +
  `sum(_sample_interval) AS msgs FROM ${DATASET} ` +
  `WHERE timestamp > now() - INTERVAL '${days}' DAY GROUP BY day ORDER BY day`,
);
console.log(`\n== chinaready-mcp usage, last ${days} days ==`);
for (const r of daily) console.log(`  ${r[0].toISOString().slice(0, 10)}  ${fmt(r[1])} rpc messages`);

const { rows: funnel } = await query(
  `SELECT blob1 AS method, blob3 AS outcome, sum(_sample_interval) AS hits FROM ${DATASET} ` +
  `WHERE timestamp > now() - INTERVAL '${days}' DAY AND blob1 NOT LIKE 'http:%' ` +
  `GROUP BY method, outcome ORDER BY hits DESC`,
);
console.log(`\n== RPC funnel (method x outcome) ==`);
for (const [method, outcome, hits] of funnel) console.log(`  ${fmt(hits).padStart(8)}  ${method}  [${outcome}]`);

const { rows: tools } = await query(
  `SELECT blob2 AS tool, blob3 AS outcome, sum(_sample_interval) AS hits FROM ${DATASET} ` +
  `WHERE timestamp > now() - INTERVAL '${days}' DAY AND blob1 = 'tools/call' ` +
  `GROUP BY tool, outcome ORDER BY hits DESC`,
);
console.log(`\n== tools/call by tool ==`);
if (!tools.length) console.log('  (no tool calls yet)');
for (const [tool, outcome, hits] of tools) console.log(`  ${fmt(hits).padStart(8)}  ${tool}  [${outcome}]`);

const { rows: clients } = await query(
  `SELECT blob4 AS ua, sum(_sample_interval) AS hits FROM ${DATASET} ` +
  `WHERE timestamp > now() - INTERVAL '${days}' DAY AND blob1 = 'tools/call' ` +
  `GROUP BY ua ORDER BY hits DESC LIMIT 20`,
);
console.log(`\n== tools/call by client (who actually invokes tools) ==`);
if (!clients.length) console.log('  (no tool calls yet)');
for (const [ua, hits] of clients) console.log(`  ${fmt(hits).padStart(8)}  ${classify(ua)}  ${(ua || '(empty)').slice(0, 80)}`);

const { rows: uaAll } = await query(
  `SELECT blob4 AS ua, sum(_sample_interval) AS hits FROM ${DATASET} ` +
  `WHERE timestamp > now() - INTERVAL '${days}' DAY GROUP BY ua ORDER BY hits DESC LIMIT 20`,
);
const byClass = {};
for (const [ua, hits] of uaAll) byClass[classify(ua)] = (byClass[classify(ua)] || 0) + Number(hits);
const total = Object.values(byClass).reduce((a, b) => a + b, 0) || 1;
console.log(`\n== all traffic by client class (top-20 UAs sampled) ==`);
for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fmt(n).padStart(8)}  ${c}  (${(100 * n / total).toFixed(0)}%)`);
}
console.log('');
