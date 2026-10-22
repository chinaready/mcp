// Copyright (c) 2026 Chinaready. All rights reserved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAsk, handleRpcMessage, toolsList } from '../src/index.js';

function searchResponse(chunks) {
  return new Response(JSON.stringify({ result: { chunks } }), { headers: { 'Content-Type': 'application/json' } });
}

function chunk(url, title, score, body = 'Body text about China hosting and ICP filing.') {
  return { score, text: `---\nurl: "${url}"\ntitle: "${title}"\ntype: "insight"\n---\n${body}` };
}

function generationResponse(text) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: text } }],
  }), { headers: { 'Content-Type': 'application/json' } });
}

function gatewayFetch(chunks, answer = 'ICP filing generally takes **two to four weeks** end to end.') {
  const impl = vi.fn(async (url, options) => {
    if (String(url) === 'https://search.chinaready.co/search') return searchResponse(chunks);
    if (/^https:\/\/gateway\.ai\.cloudflare\.com\//.test(String(url))) {
      expect(JSON.parse(options.body).model).toBe('deepseek-v4-flash');
      return generationResponse(answer);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return impl;
}

// Dummy credentials for unit tests only — no real key material here.
const testApiKey = `test-${'key'}`;
const ENV = {
  DEEPSEEK_API_KEY: testApiKey,
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  AI_GATEWAY_ID: 'gw-test-01',
};

const CTX = (fetchImpl, env = ENV, ip = '203.0.113.9') => ({ env, ip, fetchImpl });

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

  it('returns a grounded answer with structured citations', async () => {
    const fetchImpl = gatewayFetch([
      chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.9),
      chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.5, 'Renewal detail.'),
      chunk('https://chinaready.co/insights/cloud/', 'Cloud guide', 0.7),
    ]);
    const result = await callAsk({ query: 'How long does ICP filing take?' }, CTX(fetchImpl));

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.matched).toBe(true);
    expect(result.structuredContent.answer).toMatch(/two to four weeks/);
    // URL-deduped, score-ranked citations.
    expect(result.structuredContent.citations).toEqual([
      { title: 'ICP explained', url: 'https://chinaready.co/insights/icp/' },
      { title: 'Cloud guide', url: 'https://chinaready.co/insights/cloud/' },
    ]);
    expect(result.content[0].text).toContain('Sources:');
    expect(result.content[0].text).toContain('https://chinaready.co/insights/icp/');
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
    const fetchImpl = gatewayFetch([chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.9)]);
    expect((await callAsk({ query: 'q1' }, CTX(fetchImpl, env))).isError).toBeFalsy();
    const limited = await callAsk({ query: 'q2' }, CTX(fetchImpl, env));
    expect(limited.isError).toBe(true);
    expect(limited.content[0].text).toMatch(/rate limit/i);
  });

  it('falls back to a contact suggestion below the confidence floor', async () => {
    const fetchImpl = gatewayFetch([chunk('https://chinaready.co/insights/unrelated/', 'Unrelated', 0.1)]);
    const result = await callAsk({ query: 'random question' }, CTX(fetchImpl));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ answer: null, citations: [], matched: false });
    expect(result.content[0].text).toMatch(/chinaready\.co\/contact\//);
  });

  it('surfaces a configuration error when generation secrets are missing', async () => {
    const fetchImpl = gatewayFetch([chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.9)]);
    const result = await callAsk({ query: 'q' }, CTX(fetchImpl, {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not configured/i);
  });

  it('surfaces an upstream generation failure as a tool error', async () => {
    const impl = vi.fn(async (url) => {
      if (String(url) === 'https://search.chinaready.co/search') {
        return searchResponse([chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.9)]);
      }
      return new Response('boom', { status: 503 });
    });
    const result = await callAsk({ query: 'q' }, CTX(impl));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/HTTP 503/);
  });

  it('is reachable through handleRpcMessage with a context object', async () => {
    const fetchImpl = gatewayFetch([chunk('https://chinaready.co/insights/icp/', 'ICP explained', 0.9)]);
    const reply = await handleRpcMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask', arguments: { query: 'ICP?' } } },
      CTX(fetchImpl),
    );
    expect(reply.id).toBe(3);
    expect(reply.result.structuredContent.matched).toBe(true);
  });
});
