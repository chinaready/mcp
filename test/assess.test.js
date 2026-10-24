// Copyright (c) 2026 Chinaready. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_AS_OF,
  LIMITS_PUBLIC,
  analyzeManifest,
  callAssess,
  knowledgeFor,
  renderReport,
  validateManifest,
} from '../src/assess.js';

describe('knowledge base', () => {
  it('has a fresh as-of date and well-formed origins', async () => {
    expect(KNOWLEDGE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const mod = await import('../src/data/china-access-knowledge.json', { with: { type: 'json' } });
    for (const o of mod.default.origins) {
      expect(o.verdict, o.origin).toBeOneOf(['blocked', 'slow', 'degraded', 'ok']);
      expect(o.fix, o.origin).toBeTruthy();
      expect(o.source, o.origin).toMatch(/^https:\/\/chinaready\.co\//);
    }
  });

  it('matches wildcard entries by subdomain', () => {
    expect(knowledgeFor('firebasestorage.googleapis.com')?.verdict).toBe('blocked');
    expect(knowledgeFor('foo.s3.amazonaws.com')?.verdict).toBe('slow');
    expect(knowledgeFor('unknown.example.com')).toBeNull();
  });
});

describe('validateManifest', () => {
  it('requires one input mode with a valid provider', () => {
    expect(validateManifest({}).join(' ')).toContain('Provide one of');
    expect(validateManifest({ urls: ['https://a.com/'] })).toHaveLength(0);
    expect(validateManifest({ bucket: { provider: 's3', name: 'x', region: 'us-east-1', file_count: 1, total_bytes: 1 } })).toHaveLength(0);
    expect(validateManifest({ local_dir: { path: 'dist', file_count: 1, total_bytes: 1 } })).toHaveLength(0);
    expect(validateManifest({ bucket: { provider: 's3' } }).join(' ')).not.toContain('bucket.provider');
    expect(validateManifest({ bucket: { name: 'x' } }).join(' ')).toContain('bucket.provider');
  });

  it('rejects bad providers and non-http urls', () => {
    expect(validateManifest({ bucket: { provider: 'dropbox', name: 'x' } })[0]).toContain('bucket.provider');
    expect(validateManifest({ urls: ['ftp://nope.example/'] })[0]).toContain('non-http(s)');
  });

  it('enforces entry limits', () => {
    const urls = Array.from({ length: LIMITS_PUBLIC.urls + 1 }, (_, i) => `https://a.example/${i}/`);
    expect(validateManifest({ urls })).toContain(`urls exceeds ${LIMITS_PUBLIC.urls} entries.`);
    const origins = Array.from({ length: LIMITS_PUBLIC.origins + 1 }, (_, i) => ({ origin: `https://${i}.example.com` }));
    expect(validateManifest({ urls: ['https://a.com/'], third_party_origins: origins })).toContain(`third_party_origins exceeds ${LIMITS_PUBLIC.origins} entries.`);
  });
});

describe('analyzeManifest', () => {
  const base = {
    site_url: 'https://example.com',
    urls: Array.from({ length: 30 }, (_, i) => `https://example.com/p${i}/`),
    third_party_origins: [
      { origin: 'https://fonts.googleapis.com/x', refs: 10 },
      { origin: 'https://cdn.jsdelivr.net/npm/y', refs: 3 },
    ],
  };

  it('aggregates verdicts into bands', () => {
    const a = analyzeManifest(base);
    expect(a.counts.verdicts).toMatchObject({ blocked: 1, degraded: 1 });
    expect(a.bands.dependencies).toBe('high'); // any blocked origin => high
    expect(a.bands.overall).toBe('high');
    expect(a.scope).toBe('urls');
  });

  it('a clean manifest lands low', () => {
    const a = analyzeManifest({ ...base, third_party_origins: [] });
    expect(a.bands.dependencies).toBe('low');
    expect(a.bands.overall).toBe('low');
  });

  it('flags URL-list mode with its limitation note', () => {
    expect(analyzeManifest(base).urls_only_note).toMatch(/^URL-list mode/);
    expect(analyzeManifest({ ...base, bucket: { provider: 's3', name: 'b', region: 'r', file_count: 5, total_bytes: 1024 } }).urls_only_note).toBeNull();
  });

  it('bands site size from total_bytes', () => {
    const mk = (gb) => analyzeManifest({ bucket: { provider: 's3', name: 'b', region: 'r', file_count: 10, total_bytes: gb * 1024 ** 3 } });
    expect(mk(0.5).bands.size).toBe('low');
    expect(mk(5).bands.size).toBe('medium');
    expect(mk(20).bands.size).toBe('high');
  });

  it('marks forms with unknown/blocked backends appropriately', () => {
    const a = analyzeManifest({ urls: ['https://x.example/'], forms: [{ action: 'https://api.hubapi.com/f', method: 'post' }] });
    expect(a.forms[0].verdict).toBe('slow');
    expect(a.bands.forms).toBe('medium');
  });
});

describe('callAssess (tool result)', () => {
  it('returns markdown plus structured content', () => {
    const r = callAssess({ urls: ['https://a.example/'], third_party_origins: [{ origin: 'https://fonts.gstatic.com/s/x', refs: 4 }] });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('# China readiness assessment');
    expect(r.content[0].text).toContain('`blocked` fonts.gstatic.com');
    expect(r.content[0].text).toContain('Cost bands');
    expect(r.structuredContent.bands.overall).toBe('high');
    expect(r.structuredContent.as_of).toBe(KNOWLEDGE_AS_OF);
  });

  it('surfaces validation errors as isError', () => {
    const r = callAssess({ bucket: { provider: 'dropbox', name: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid manifest');
    expect(callAssess({}).isError).toBe(true);
  });
});

describe('renderReport', () => {
  it('keeps the honest unknown-origin footer', () => {
    const text = renderReport(analyzeManifest({ urls: ['https://a.example/'], third_party_origins: [{ origin: 'https://zz.example.net', refs: 1 }] }));
    expect(text).toContain('not in the knowledge base yet');
    expect(text).toContain('chinaready.co/contact/');
  });
});
