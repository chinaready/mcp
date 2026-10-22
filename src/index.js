// Copyright (c) 2026 Chinaready. All rights reserved.
// Stateless remote MCP server (Streamable HTTP, JSON responses) wrapping the
// public Chinaready retrieval API. No bindings, no secrets — deploy anywhere.

export const SERVER_INFO = {
  name: 'chinaready',
  version: '1.0.1',
  title: 'Chinaready China Market-Entry Search',
};

export const INSTRUCTIONS =
  'Search and read chinaready.co — the practical guide for Western SaaS, app, and game teams entering Mainland China. ' +
  'Use `search` for any question about ICP filing and licensing, app-store and game publishing, China cloud regions, payments, or compliance; ' +
  '`list_topics` to see what the corpus covers; `get_article` to read a full page. Always cite the chinaready.co URLs included in results.';

const SEARCH_ENDPOINT = 'https://search.chinaready.co/search';
const SITE_ORIGIN = 'https://chinaready.co';
const MAX_SNIPPET = 300;
const MAX_SEARCH_RESULTS = 8;
const MAX_ARTICLE_CHARS = 20000;

// Static topic catalog (kept in sync with the site's cluster hubs).
export const TOPICS = [
  { topic: 'ICP filing and licensing', hub_url: '/china-readiness-assessment/', description: 'Beian record-filing, the B25 ICP license threshold, domain/DNS requirements, and app filing.', example_queries: ['How long does ICP filing take?', 'When does a SaaS need an ICP license (B25)?', 'ICP filing via domain DNS'] },
  { topic: 'App and game publishing', hub_url: '/services/china-mobile-app-distribution/', description: 'Android multi-console uploads, App Store China requirements, game licensing, real-name verification.', example_queries: ['How do foreign apps get on Chinese Android stores?', 'China real-name verification for apps', 'App Store China publishing requirements'] },
  { topic: 'China cloud regions', hub_url: '/insights/aws-china-partition-benchmark/', description: 'AWS China partition, Azure China, Alibaba Cloud and peers — performance, partitions, and engineering planes.', example_queries: ['Is AWS China a separate cloud?', 'Alibaba Cloud China regions', 'AWS China partition performance benchmark'] },
  { topic: 'Website and SaaS acceleration', hub_url: '/services/china-access-acceleration/', description: 'Keeping offshore websites, SaaS, and APIs reachable and fast from Mainland China.', example_queries: ['My SaaS is slow in China — what breaks first?', 'China CDN for offshore SaaS', 'Great Firewall diagnostics'] },
  { topic: 'Hosting and operations', hub_url: '/services/china-product-hosting/', description: 'Mainland hosting and proxy patterns for websites, SaaS backends, and app APIs.', example_queries: ['Host in China or Hong Kong?', 'China-side proxy for APIs', 'Running app backends in Mainland China'] },
  { topic: 'Payments and monetisation', hub_url: '/insights/app-monetisation-china/', description: 'IAP rails, ad networks, channel cuts, and settlement paths for China revenue.', example_queries: ['IAP vs ads in China', 'WeChat Pay for foreign SaaS', 'Android channel revenue cuts'] },
  { topic: 'Compliance and software regulation', hub_url: '/insights/software-copyright-2026-rules/', description: 'Software copyright registration, data rules, advertising law, and 2026 regulatory changes.', example_queries: ['China software copyright registration', 'China data compliance for foreign SaaS', 'China advertising law for apps'] },
];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function toolsList() {
  return [
    {
      name: 'search',
      title: 'Search Chinaready guides',
      description: 'Semantic + keyword search over chinaready.co guides, services, and FAQ. Returns ranked excerpts whose source headers carry absolute chinaready.co URLs to cite.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The question or keywords, e.g. "ICP filing timeline" or "B25".' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max article results (default 5).' },
        },
        required: ['query'],
      },
      annotations: READ_ONLY,
    },
    {
      name: 'list_topics',
      title: 'List covered topics',
      description: 'List the China market-entry topics the chinaready.co corpus covers, with example queries and hub page paths for each.',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
    },
    {
      name: 'get_article',
      title: 'Read a full article',
      description: 'Fetch a chinaready.co page as clean Markdown (site pages only). Use paths returned by search/list_topics, e.g. "/insights/china-icp-and-psb-filing-explained/".',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Site path starting with "/", ending with "/". Only chinaready.co pages are allowed.' },
        },
        required: ['path'],
      },
      annotations: READ_ONLY,
    },
  ];
}

// Chunks from the retrieval API embed a url/title/type frontmatter header in
// their text; parse it out and dedupe to article level.
function chunkMeta(chunk) {
  const text = typeof chunk.text === 'string' ? chunk.text : '';
  const url = text.match(/^url:\s*"?([^"\n]+)"?/m)?.[1] || chunk.item?.metadata?.url || '';
  const title = text.match(/^title:\s*"?([^"\n]+)"?/m)?.[1] || chunk.item?.metadata?.title || url;
  return { url, title, score: Number(chunk.score ?? 0), text };
}

function snippet(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/\s+/g, ' ').trim();
  return body.length > MAX_SNIPPET ? `${body.slice(0, MAX_SNIPPET - 1)}…` : body;
}

export async function callSearch(args, fetchImpl = fetch) {
  const query = String(args?.query ?? '').trim();
  if (!query || query.length > 400) return { isError: true, content: [{ type: 'text', text: 'query must be a non-empty string of at most 400 characters.' }] };
  const limit = Math.min(Math.max(Number.parseInt(args?.limit, 10) || 5, 1), 10);

  const response = await fetchImpl(SEARCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: limit * 3 }),
  });
  if (!response.ok) {
    return { isError: true, content: [{ type: 'text', text: `Retrieval upstream unavailable (HTTP ${response.status}).` }] };
  }
  const payload = await response.json().catch(() => null);
  const chunks = payload?.result?.chunks ?? [];

  const seen = new Map();
  for (const chunk of chunks) {
    const meta = chunkMeta(chunk);
    if (!meta.url) continue;
    const prev = seen.get(meta.url);
    if (!prev || meta.score > prev.score) seen.set(meta.url, meta);
    if (seen.size >= limit) break;
  }
  if (seen.size === 0) {
    return { content: [{ type: 'text', text: `No matching pages for "${query}". Try list_topics for what the corpus covers.` }] };
  }
  const lines = [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .map((m, i) => `${i + 1}. ${m.title}\n   ${m.url} (relevance ${m.score.toFixed(2)})\n   ${snippet(m.text)}`);
  return { content: [{ type: 'text', text: `Top matches for "${query}":\n\n${lines.join('\n\n')}\n\nCite the URLs above; read the full page with get_article.` }] };
}

export function callListTopics() {
  const lines = TOPICS.map(
    (t, i) => `${i + 1}. ${t.topic} — ${t.description}\n   Hub: ${SITE_ORIGIN}${t.hub_url}\n   Try: ${t.example_queries.map((q) => `"${q}"`).join(', ')}`,
  );
  return { content: [{ type: 'text', text: `The chinaready.co corpus covers:\n\n${lines.join('\n\n')}` }] };
}

const SAFE_PATH = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/$/;

// Text extraction for the HTML fallback: drop non-content blocks, convert
// block-level closers to newlines, then decode entities — &amp; last, so
// escaped markup like "&amp;lt;" survives as the literal text "&lt;".
function decodeCodePoint(value) {
  const cp = Number(value);
  if (!Number.isInteger(cp) || cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

export function htmlToText(html) {
  return (html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<\/(?:p|h[1-6]|li|tr|blockquote|pre|div|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => decodeCodePoint(dec))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function callGetArticle(args, fetchImpl = fetch) {
  const path = String(args?.path ?? '').trim();
  if (!SAFE_PATH.test(path) || path.length > 120) {
    return { isError: true, content: [{ type: 'text', text: 'path must be a chinaready.co site path like "/insights/china-icp-and-psb-filing-explained/".' }] };
  }
  const response = await fetchImpl(`${SITE_ORIGIN}${path}`, {
    headers: {
      Accept: 'text/markdown',
      'User-Agent': 'ChinareadyMCP/1.0 (+https://mcp.chinaready.co)',
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    return { isError: true, content: [{ type: 'text', text: `Could not read ${path} (HTTP ${response.status}). Search for the exact path first.` }] };
  }
  let markdown;
  if (/text\/markdown/.test(contentType)) {
    markdown = await response.text();
  } else {
    // Fallback: strip a minimal HTML shell to readable text when the zone's
    // Markdown converter does not apply to this subrequest.
    const html = await response.text();
    const rawTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
    const title = rawTitle ? htmlToText(rawTitle) : path;
    markdown = `# ${title}\n\n${htmlToText(html)}`;
  }
  const clipped = markdown.length > MAX_ARTICLE_CHARS ? `${markdown.slice(0, MAX_ARTICLE_CHARS)}\n\n[truncated at ${MAX_ARTICLE_CHARS} characters]` : markdown;
  return { content: [{ type: 'text', text: `# ${SITE_ORIGIN}${path}\n\n${clipped}` }] };
}

const SUPPORTED_PROTOCOL = ['2025-06-18', '2025-03-26', '2024-11-05'];

export async function handleRpcMessage(message, fetchImpl = fetch) {
  if (!message || typeof message !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = message;
  if (method?.startsWith('notifications/')) return undefined; // notifications get no response

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL.includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolsList() } };
    case 'tools/call': {
      const name = params?.name;
      let result;
      try {
        if (name === 'search') result = await callSearch(params?.arguments, fetchImpl);
        else if (name === 'list_topics') result = callListTopics();
        else if (name === 'get_article') result = await callGetArticle(params?.arguments, fetchImpl);
        else result = { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
      } catch {
        result = { isError: true, content: [{ type: 'text', text: 'Tool execution failed; retry shortly.' }] };
      }
      return { jsonrpc: '2.0', id, result };
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// CORS is deliberately open (*) but scoped to the MCP protocol surface
// (POST requests and their preflight): this is a public, read-only,
// unauthenticated server and browser-based MCP clients are supported
// consumers. Rejected methods get no CORS headers, and GET is not
// advertised because the worker never serves it.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

// Usage analytics (Analytics Engine dataset chinaready_mcp_usage):
// one data point per RPC message — blobs: [method, tool, outcome, ua],
// doubles: [1]. Method/tool names only; arguments and query content are
// never logged.
const UA_BLOB_MAX = 120;

export function usageLabel(message, reply) {
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
    return { method: 'invalid', tool: '', outcome: reply ? 'ok' : 'dropped' };
  }
  if (message.method.startsWith('notifications/')) {
    return { method: message.method, tool: '', outcome: 'notification' };
  }
  const tool = message.method === 'tools/call'
    ? (typeof message.params?.name === 'string' && message.params.name ? message.params.name : 'unknown')
    : '';
  let outcome = 'ok';
  if (reply?.error) outcome = reply.error.code === -32601 ? 'method_not_found' : 'rpc_error';
  else if (reply?.result?.isError) outcome = 'tool_error';
  return { method: message.method, tool, outcome };
}

function writeUsage(env, label, ua) {
  try {
    env?.USAGE?.writeDataPoint?.({
      blobs: [label.method, label.tool, label.outcome, String(ua || '').slice(0, UA_BLOB_MAX)],
      doubles: [1],
    });
  } catch {
    // Usage analytics must never break request serving.
  }
}

function json(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    const ua = request.headers.get('user-agent') || '';

    if (request.method === 'OPTIONS') {
      writeUsage(env, { method: 'http:OPTIONS', tool: '', outcome: 'preflight' }, ua);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      writeUsage(env, { method: `http:${request.method}`, tool: '', outcome: 'method_not_allowed' }, ua);
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS' } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      writeUsage(env, { method: 'http:POST', tool: '', outcome: 'parse_error' }, ua);
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }

    if (Array.isArray(body)) {
      const replies = [];
      for (const message of body) {
        const reply = await handleRpcMessage(message);
        writeUsage(env, usageLabel(message, reply), ua);
        if (reply) replies.push(reply);
      }
      return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS_HEADERS });
    }

    const reply = await handleRpcMessage(body);
    writeUsage(env, usageLabel(body, reply), ua);
    return reply ? json(reply) : new Response(null, { status: 202, headers: CORS_HEADERS });
  },
};
