// Copyright (c) 2026 Chinaready. All rights reserved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { handleRpcMessage, toolsList, callSearch, callGetArticle, callListTopics, htmlToText, SERVER_INFO, usageLabel } from '../src/index.js';

function rpc(method, params, id = 1, fetchImpl) {
  return handleRpcMessage({ jsonrpc: '2.0', id, method, params }, fetchImpl);
}

describe('initialize', () => {
  it('returns branded serverInfo, capabilities, and instructions', async () => {
    const reply = await rpc('initialize', { protocolVersion: '2025-06-18' });
    expect(reply.result.serverInfo).toEqual(SERVER_INFO);
    expect(reply.result.serverInfo.name).toBe('chinaready');
    expect(reply.result.serverInfo.title).toBeTruthy();
    expect(reply.result.capabilities.tools).toEqual({ listChanged: false });
    expect(reply.result.instructions).toMatch(/cite the chinaready\.co URLs/i);
  });

  it('echoes a supported protocol version and falls back for unknown ones', async () => {
    expect((await rpc('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion).toBe('2025-03-26');
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
  });
});

describe('tools/list', () => {
  it('exposes six tools, each with a title and annotations', async () => {
    const reply = await rpc('tools/list', {});
    const tools = reply.result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['ask', 'assess_china_readiness', 'get_article', 'list_topics', 'search', 'submit_baseline']);
    for (const tool of tools) {
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.annotations, `${tool.name} annotations`).toMatchObject({ destructiveHint: false });
      expect(tool.inputSchema.type).toBe('object');
    }
    // Knowledge tools are read-only; only submit_baseline writes (explicitly).
    for (const tool of tools.filter((t) => t.name !== 'submit_baseline')) {
      expect(tool.annotations.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
    }
    expect(reply.result.tools.find((t) => t.name === 'submit_baseline').annotations.readOnlyHint).toBe(false);
  });

  it('module export matches the RPC result', () => {
    expect(toolsList()).toHaveLength(6);
  });
});

describe('tools/call — search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dedupes chunks to ranked articles with absolute URLs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      result: {
        chunks: [
          { score: 0.9, text: '---\nurl: "https://chinaready.co/insights/icp/"\ntitle: "ICP explained"\ntype: "insight"\n---\nFiling takes two to four weeks end to end.' },
          { score: 0.7, text: '---\nurl: "https://chinaready.co/insights/icp/"\ntitle: "ICP explained"\ntype: "insight"\n---\nRenewal is annual.' },
          { score: 0.75, text: '---\nurl: "https://chinaready.co/faq/"\ntitle: "FAQ"\ntype: "faq"\n---\nGeneral questions.' },
        ],
      },
    }), { headers: { 'Content-Type': 'application/json' } }));

    const reply = await rpc('tools/call', { name: 'search', arguments: { query: 'icp filing' } }, 1, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://search.chinaready.co/search', expect.objectContaining({ method: 'POST' }));
    const text = reply.result.content[0].text;
    expect(text).toContain('1. ICP explained');
    expect(text).toContain('https://chinaready.co/insights/icp/');
    expect(text).toContain('Filing takes two to four weeks');
    expect(reply.result.isError).toBeUndefined();
  });

  it('rejects empty or oversized queries without calling upstream', async () => {
    const fetchImpl = vi.fn();
    expect((await handleRpcMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: '' } } }, fetchImpl)).result.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps upstream failures to a clean isError result', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const reply = await rpc('tools/call', { name: 'search', arguments: { query: 'x' } }, 1, fetchImpl);
    expect(reply.result.isError).toBe(true);
  });
});

describe('tools/call — list_topics / get_article', () => {
  it('lists topics with hub URLs and example queries', async () => {
    const text = callListTopics().content[0].text;
    expect(text).toContain('ICP filing and licensing');
    expect(text).toContain('https://chinaready.co/');
  });

  it('accepts only safe site paths and rejects everything else', async () => {
    const fetchImpl = vi.fn();
    const bad = await callGetArticle({ path: 'https://evil.example/x/' }, fetchImpl);
    const bad2 = await callGetArticle({ path: '/../etc/passwd' }, fetchImpl);
    expect(bad.isError).toBe(true);
    expect(bad2.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns markdown when the site serves it', async () => {
    const fetchImpl = vi.fn(async () => new Response('# Title\n\nBody', { headers: { 'Content-Type': 'text/markdown' } }));
    const result = await callGetArticle({ path: '/insights/icp/' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://chinaready.co/insights/icp/', expect.objectContaining({ headers: expect.objectContaining({ Accept: 'text/markdown' }) }));
    expect(result.content[0].text).toContain('# Title');
  });

  it('falls back to readable text when the site answers HTML', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      '<html><head><title>FAQ</title><style>x{}</style></head><body><main><h1>Questions</h1><p>Answers here.</p></main></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    ));
    const result = await callGetArticle({ path: '/faq/' }, fetchImpl);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('# FAQ');
    expect(result.content[0].text).toContain('Answers here.');
    expect(result.content[0].text).not.toContain('<');
  });
});

describe('htmlToText (HTML fallback extraction)', () => {
  it('removes scripts, styles, noscript blocks, and comments entirely', () => {
    const text = htmlToText('<body><main><!-- note --><script>alert(1)</script><style>a{}</style><noscript>off</noscript><p>Keep.</p></main></body>');
    expect(text).toBe('Keep.');
  });

  it('decodes named and numeric entities exactly once', () => {
    expect(htmlToText('A &amp; B')).toBe('A & B');
    expect(htmlToText('&amp;lt; stays literal')).toBe('&lt; stays literal');
    expect(htmlToText('dash &#8212; dash &#x2014; done')).toBe('dash — dash — done');
    expect(htmlToText('&apos;quoted&apos;')).toBe("'quoted'");
  });

  it('drops invalid or surrogate code points instead of throwing', () => {
    expect(htmlToText('&#0;&#x110000;&#xD800;ok')).toBe('ok');
  });

  it('keeps block boundaries as line breaks instead of one blob', () => {
    const text = htmlToText('<main><h1>Head</h1><p>One.</p><p>Two.<br/>Split.</p></main>');
    expect(text).toBe('Head\nOne.\nTwo.\nSplit.');
  });
});

describe('usage analytics', () => {
  function stubUsage() {
    const points = [];
    return { env: { USAGE: { writeDataPoint: (p) => points.push(p) } }, points };
  }

  it('classifies rpc messages into method/tool/outcome', () => {
    expect(usageLabel({ method: 'initialize' }, { result: {} })).toEqual({ method: 'initialize', tool: '', outcome: 'ok' });
    expect(usageLabel({ method: 'notifications/initialized' }, undefined))
      .toEqual({ method: 'notifications/initialized', tool: '', outcome: 'notification' });
    expect(usageLabel({ method: 'tools/call', params: { name: 'search' } }, { result: { isError: true } }))
      .toEqual({ method: 'tools/call', tool: 'search', outcome: 'tool_error' });
    expect(usageLabel({ method: 'tools/call', params: {} }, { result: {} }))
      .toEqual({ method: 'tools/call', tool: 'unknown', outcome: 'ok' });
    expect(usageLabel({ method: 'resources/list' }, { error: { code: -32601, message: 'Method not found' } }).outcome).toBe('method_not_found');
    expect(usageLabel(null, { error: { code: -32600 } }).method).toBe('invalid');
  });

  it('writes one data point per batched message with the UA blob', async () => {
    const { env, points } = stubUsage();
    const res = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'node' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
    }), env);
    expect(res.status).toBe(200);
    expect(points.map((p) => p.blobs.slice(0, 3))).toEqual([
      ['tools/list', '', 'ok'],
      ['notifications/initialized', '', 'notification'],
    ]);
    expect(points[0].doubles).toEqual([1]);
    expect(points[0].blobs[3]).toBe('node');
  });

  it('labels tools/call with the tool name through the HTTP surface', async () => {
    const { env, points } = stubUsage();
    await worker.fetch(new Request('https://mcp.chinaready.co/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_topics' } }),
    }), env);
    expect(points[0].blobs.slice(0, 3)).toEqual(['tools/call', 'list_topics', 'ok']);
  });

  it('records rejected methods and parse errors, and never throws without the binding', async () => {
    // No env at all — must not throw.
    expect((await worker.fetch(new Request('https://mcp.chinaready.co/mcp', { method: 'HEAD' }))).status).toBe(405);

    const { env, points } = stubUsage();
    await worker.fetch(new Request('https://mcp.chinaready.co/mcp', { method: 'GET', headers: { 'User-Agent': 'x'.repeat(300) } }), env);
    expect(points[0].blobs).toEqual(['http:GET', '', 'method_not_allowed', 'x'.repeat(120)]);

    const bad = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', { method: 'POST', body: 'not json' }), env);
    expect(bad.status).toBe(400);
    expect(points[1].blobs.slice(0, 3)).toEqual(['http:POST', '', 'parse_error']);
  });
});

describe('HTTP surface', () => {
  it('GET returns 405 without CORS; OPTIONS preflight carries scoped CORS', async () => {
    const getRes = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', { method: 'GET' }));
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const optionsRes = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', { method: 'OPTIONS' }));
    expect(optionsRes.status).toBe(204);
    expect(optionsRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(optionsRes.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  it('POST routes JSON-RPC and notifications return 202', async () => {
    const res = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
    }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.result.tools).toHaveLength(6);

    const note = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }));
    expect(note.status).toBe(202);
  });

  it('handles JSON-RPC batches', async () => {
    const res = await worker.fetch(new Request('https://mcp.chinaready.co/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });
});
