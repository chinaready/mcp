// Copyright (c) 2026 Chinaready. All rights reserved.
// Stateless remote MCP server (Streamable HTTP, JSON responses) wrapping the
// public Chinaready retrieval API. No bindings, no secrets — deploy anywhere.

export const SERVER_INFO = {
  name: 'chinaready',
  version: '1.0.0',
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

export async function callGetArticle(args, fetchImpl = fetch) {
  const path = String(args?.path ?? '').trim();
  if (!SAFE_PATH.test(path) || path.length > 120) {
    return { isError: true, content: [{ type: 'text', text: 'path must be a chinaready.co site path like "/insights/china-icp-and-psb-filing-explained/".' }] };
  }
  const response = await fetchImpl(`${SITE_ORIGIN}${path}`, {
    headers: { Accept: 'text/markdown, text/plain' },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !/text\/(markdown|plain)/.test(contentType)) {
    return { isError: true, content: [{ type: 'text', text: `Could not read ${path} as Markdown (HTTP ${response.status}). Search for the exact path first.` }] };
  }
  const markdown = await response.text();
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function json(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS_HEADERS } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }

    if (Array.isArray(body)) {
      const replies = [];
      for (const message of body) {
        const reply = await handleRpcMessage(message);
        if (reply) replies.push(reply);
      }
      return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS_HEADERS });
    }

    const reply = await handleRpcMessage(body);
    return reply ? json(reply) : new Response(null, { status: 202, headers: CORS_HEADERS });
  },
};
