// Trusted-proxy client-IP resolution — the wb.launchready.cn proxy
// (launchready-prd repo) injects X-Client-IP + X-Trusted-Proxy so per-IP
// rate limits key on real users behind the Beijing ECS egress.
import { describe, it, expect } from 'vitest';
import { resolveRequestIp } from '../src/index.js';

const SECRET = 'proxy-secret-0123456789abcdef';

function req(headers = {}) {
  return new Request('https://mcp.chinaready.co/mcp', { method: 'POST', headers });
}

describe('resolveRequestIp', () => {
  it('trusts the forwarded IP when the shared secret matches', () => {
    const env = { TRUSTED_PROXY_SECRET: SECRET };
    const request = req({ 'X-Trusted-Proxy': SECRET, 'X-Client-IP': '203.0.113.9', 'CF-Connecting-IP': 'ecs-egress-ip' });
    expect(resolveRequestIp(request, env)).toBe('203.0.113.9');
  });

  it('falls back to the edge IP when the secret does not match', () => {
    const env = { TRUSTED_PROXY_SECRET: SECRET };
    const request = req({ 'X-Trusted-Proxy': 'wrong-secret-0123456789', 'X-Client-IP': '6.6.6.6', 'CF-Connecting-IP': '1.2.3.4' });
    expect(resolveRequestIp(request, env)).toBe('1.2.3.4');
  });

  it('falls back when no secret is configured in the worker', () => {
    const request = req({ 'X-Trusted-Proxy': SECRET, 'X-Client-IP': '6.6.6.6', 'CF-Connecting-IP': '1.2.3.4' });
    expect(resolveRequestIp(request, {})).toBe('1.2.3.4');
  });

  it('keeps the edge IP for ordinary callers (no proxy headers)', () => {
    const env = { TRUSTED_PROXY_SECRET: SECRET };
    const request = req({ 'CF-Connecting-IP': '198.51.100.7' });
    expect(resolveRequestIp(request, env)).toBe('198.51.100.7');
  });

  it('ignores the pair when the proxy sends the secret but no client IP', () => {
    const env = { TRUSTED_PROXY_SECRET: SECRET };
    const request = req({ 'X-Trusted-Proxy': SECRET, 'CF-Connecting-IP': '198.51.100.7' });
    expect(resolveRequestIp(request, env)).toBe('198.51.100.7');
  });

  it('trims whitespace around secret and forwarded IP', () => {
    const env = { TRUSTED_PROXY_SECRET: `  ${SECRET}  ` };
    const request = req({ 'X-Trusted-Proxy': ` ${SECRET} `, 'X-Client-IP': ' 203.0.113.9 ', 'CF-Connecting-IP': '1.2.3.4' });
    expect(resolveRequestIp(request, env)).toBe('203.0.113.9');
  });
});
