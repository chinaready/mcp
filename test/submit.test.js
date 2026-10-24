// Copyright (c) 2026 Chinaready. All rights reserved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callSubmitBaseline, validateSubmission } from '../src/submit.js';

function okFetch(body = { ok: true }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } }));
}

const good = { email: 'founder@example.com', site_url: 'https://example.com', summary: 'blocked: fonts.googleapis.com' };
const env = { MCP_LEAD_SHARED_KEY: 'test-secret' };

describe('validateSubmission', () => {
  it('requires a valid email and optional http(s) site_url', () => {
    expect(validateSubmission(good)).toHaveLength(0);
    expect(validateSubmission({ ...good, email: 'not-an-email' })[0]).toContain('email');
    expect(validateSubmission({ ...good, site_url: 'javascript:alert(1)' })[0]).toContain('site_url');
  });

  it('caps summary length', () => {
    expect(validateSubmission({ ...good, summary: 'x'.repeat(4001) })[0]).toContain('summary');
  });
});

describe('callSubmitBaseline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends only name/email/site_url/summary with the shared secret', async () => {
    const fetchImpl = okFetch({ ok: true, case_number: 'MCP-2026-0001' });
    const r = await callSubmitBaseline(good, { env, ip: '203.0.113.9', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://chinaready.co/api/contact/mcp');
    expect(init.headers.Authorization).toBe('Bearer test-secret');
    expect(init.headers['X-Client-IP']).toBe('203.0.113.9');
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(['email', 'name', 'site_url', 'summary']);
    expect(r.structuredContent).toEqual({ submitted: true, case_number: 'MCP-2026-0001' });
    expect(r.content[0].text).toContain('MCP-2026-0001');
  });

  it('reports not-configured when the secret is missing', async () => {
    const r = await callSubmitBaseline(good, { env: {}, fetchImpl: okFetch() });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('MCP_LEAD_SHARED_KEY');
    expect(r.content[0].text).toContain('chinaready.co/contact/');
  });

  it('maps upstream failures to isError without leaking internals', async () => {
    const fail = vi.fn(async () => new Response('nope', { status: 503 }));
    const r = await callSubmitBaseline(good, { env, fetchImpl: fail });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('HTTP 503');
  });

  it('rejects invalid input before any network call', async () => {
    const fetchImpl = okFetch();
    const r = await callSubmitBaseline({ email: 'bad' }, { env, fetchImpl });
    expect(r.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
