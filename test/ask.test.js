// Copyright (c) 2026 Chinaready. All rights reserved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAsk, handleRpcMessage, toolsList } from '../src/index.js';

const CHAT = 'https://chinaready.co/api/assistant/chat';

function chatResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

// Deterministic fetch double: each call returns the next canned reply and
// records the request for handshake assertions.
function makeSiteChat(payloadByCall) {
  const seen = [];
  const fn = vi.fn(async (url, options) => {
    seen.push({ url: String(url), headers: { ...options.headers }, body: JSON.parse(options.body) });
    const reply = payloadByCall[seen.length - 1];
    if (reply instanceof Response) return reply;
    return chatResponse(reply);
  });
  fn.seen = seen;
  return fn;
}

// Dummy service secret for unit tests only — no real key material here.
const testSecret = `svc-${'secret'}`;
const ENV = { ASSISTANT_SERVICE_SECRET: testSecret };

const CTX = (fetchImpl, env = ENV, ip = '203.0.113.9') => ({ env, ip, fetchImpl });

const ANSWER = {
  action: 'answer',
  text: 'ICP filing generally takes **two to four weeks** end to end.',
  sources: [
    // Site chat returns site-relative paths; citations must come out absolute.
    { url: '/insights/icp/', title: 'ICP explained', type: 'insight' },
    { url: 'https://chinaready.co/insights/cloud/', title: 'Cloud guide', type: 'insight' },
  ],
};

describe('tools/list — ask', () => {
  it('advertises ask with a query schema and non-idempotent annotation', () => {
    const ask = toolsList().find((tool) => tool.name === 'ask');
    expect(ask).toBeTruthy();
    expect(ask.inputSchema.required).toEqual(['query']);
    expect(ask.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false });
  });
});

describe('tools/call — ask', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('proxies the question to the site chat endpoint with the service handshake', async () => {
    const fetchImpl = makeSiteChat([ANSWER]);
    const result = await callAsk({ query: 'How long does ICP filing take?' }, CTX(fetchImpl));

    expect(fetchImpl.seen).toHaveLength(1);
    const call = fetchImpl.seen[0];
    expect(call.url).toBe(CHAT);
    expect(call.headers.Authorization).toBe(`Bearer ${testSecret}`);
    expect(call.headers['X-Client-IP']).toBe('203.0.113.9');
    expect(call.body.messages).toEqual([{ role: 'user', content: 'How long does ICP filing take?' }]);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.matched).toBe(true);
    expect(result.structuredContent.answer).toMatch(/two to four weeks/);
    expect(result.structuredContent.citations).toEqual([
      { title: 'ICP explained', url: 'https://chinaready.co/insights/icp/' },
      { title: 'Cloud guide', url: 'https://chinaready.co/insights/cloud/' },
    ]);
    expect(result.content[0].text).toContain('Sources:');
    expect(result.content[0].text).toContain('https://chinaready.co/insights/icp/');
  });

  it('filters non-site URLs out of citations and tolerates missing titles', async () => {
    const fetchImpl = makeSiteChat([{
      action: 'answer',
      text: 'Answer.',
      sources: [
        { url: 'https://evil.example.com/x', title: 'Evil' },
        { url: 'https://chinaready.co/insights/icp/' },
      ],
    }]);
    const result = await callAsk({ query: 'q' }, CTX(fetchImpl));
    expect(result.structuredContent.citations).toEqual([
      { title: 'https://chinaready.co/insights/icp/', url: 'https://chinaready.co/insights/icp/' },
    ]);
  });

  it('rejects empty or over-long queries before any upstream call', async () => {
    const fetchImpl = vi.fn();
    expect((await callAsk({ query: '   ' }, CTX(fetchImpl))).isError).toBe(true);
    expect((await callAsk({ query: 'x'.repeat(401) }, CTX(fetchImpl))).isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enforces the per-IP rate limit', async () => {
    let calls = 0;
    const env = { ...ENV, askLimiter: { check: async () => (calls++ === 0) } };
    const fetchImpl = makeSiteChat([ANSWER]);
    expect((await callAsk({ query: 'q1' }, CTX(fetchImpl, env))).isError).toBeFalsy();
    const limited = await callAsk({ query: 'q2' }, CTX(fetchImpl, env));
    expect(limited.isError).toBe(true);
    expect(limited.content[0].text).toMatch(/rate limit/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps the contact_form fallback (low confidence) to matched=false', async () => {
    const fetchImpl = makeSiteChat([{ action: 'contact_form', reason: 'low_match' }]);
    const result = await callAsk({ query: 'random question' }, CTX(fetchImpl));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ answer: null, citations: [], matched: false });
    expect(result.content[0].text).toMatch(/chinaready\.co\/contact\//);
  });

  it('surfaces a configuration error when the service secret is missing', async () => {
    const fetchImpl = makeSiteChat([ANSWER]);
    const result = await callAsk({ query: 'q' }, CTX(fetchImpl, {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not configured/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces an upstream generation failure as a tool error', async () => {
    const fetchImpl = makeSiteChat([new Response('boom', { status: 503 })]);
    const result = await callAsk({ query: 'q' }, CTX(fetchImpl));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/HTTP 503/);
  });

  it('is reachable through handleRpcMessage with a context object', async () => {
    const fetchImpl = makeSiteChat([ANSWER]);
    const reply = await handleRpcMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask', arguments: { query: 'ICP?' } } },
      CTX(fetchImpl),
    );
    expect(reply.id).toBe(3);
    expect(reply.result.structuredContent.matched).toBe(true);
  });
});
