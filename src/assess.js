// Copyright (c) 2026 Chinaready. All rights reserved.
// assess_china_readiness — pure, server-side analysis of a manifest the
// calling agent enumerated locally (bucket listing, build-output directory,
// or URL list). The server never fetches user URLs or bucket contents; it
// only joins the manifest against the China-access knowledge base.

import KNOWLEDGE from './data/china-access-knowledge.json' with { type: 'json' };

export const KNOWLEDGE_AS_OF = KNOWLEDGE.as_of;

const VERDICT_RANK = { blocked: 0, slow: 1, degraded: 2, ok: 3, unknown: 4 };
const WORST_TO_LABEL = { blocked: 'high', slow: 'medium', degraded: 'medium' };

const LIMITS = {
  origins: 500,
  urls: 200,
  payloadChars: 256 * 1024,
  forms: 50,
};

export const LIMITS_PUBLIC = LIMITS;

// --- manifest validation ---------------------------------------------------

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeOrigin(raw) {
  try {
    const u = new URL(String(raw));
    return { host: u.hostname.toLowerCase(), url: u.origin };
  } catch {
    return null;
  }
}

// Wildcard entries in the knowledge base (*.googleapis.com) match subdomains.
export function knowledgeFor(host) {
  const exact = KNOWLEDGE.origins.find((o) => o.origin === host);
  if (exact) return exact;
  const labels = host.split('.');
  for (let i = 1; i < labels.length - 1; i += 1) {
    const wildcard = `*.${labels.slice(i).join('.')}`;
    const hit = KNOWLEDGE.origins.find((o) => o.origin === wildcard);
    if (hit) return hit;
  }
  return null;
}

function countToBand(n, low, high) {
  if (n >= high) return 'high';
  if (n >= low) return 'medium';
  return 'low';
}

function bytesToBand(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  if (bytes >= 10 * 1024 ** 3) return 'high';
  if (bytes >= 1024 ** 3) return 'medium';
  return 'low';
}

// --- analysis --------------------------------------------------------------

export function analyzeManifest(manifest) {
  const originsInput = Array.isArray(manifest?.third_party_origins) ? manifest.third_party_origins : [];
  const urlsInput = Array.isArray(manifest?.urls) ? manifest.urls : [];
  const formsInput = Array.isArray(manifest?.forms) ? manifest.forms : [];
  const bucket = manifest?.bucket && typeof manifest.bucket === 'object' ? manifest.bucket : null;
  const localDir = manifest?.local_dir && typeof manifest.local_dir === 'object' ? manifest.local_dir : null;

  const rows = [];
  for (const item of originsInput) {
    const norm = normalizeOrigin(item?.origin ?? item);
    if (!norm) continue;
    const refs = Number(item?.refs) > 0 ? Number(item.refs) : 1;
    const known = knowledgeFor(norm.host);
    rows.push({
      origin: norm.host,
      label: known?.label ?? norm.host,
      refs,
      verdict: known?.verdict ?? KNOWLEDGE.unknown_origin_verdict,
      category: known?.category ?? null,
      fix: known?.fix ?? null,
      source: known?.source ?? null,
    });
  }
  rows.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.refs - a.refs);

  const counts = { blocked: 0, slow: 0, degraded: 0, ok: 0, unknown: 0 };
  for (const r of rows) counts[r.verdict] += 1;

  const worst = ['blocked', 'slow', 'degraded'].find((v) => counts[v] > 0) ?? null;
  const dependencyBand = worst ? WORST_TO_LABEL[worst] : (rows.length ? 'low' : 'low');

  const fileCount = Number(bucket?.file_count ?? localDir?.file_count) || rows.length + urlsInput.length;
  const totalBytes = Number(bucket?.total_bytes ?? localDir?.total_bytes) || 0;
  const sizeBand = bytesToBand(totalBytes);
  const pageCountBand = countToBand(urlsInput.length || Math.ceil(fileCount / 20), 20, 100);

  const forms = formsInput
    .map((f) => {
      const action = typeof f?.action === 'string' ? f.action : '';
      const norm = action ? normalizeOrigin(action) : null;
      const known = norm ? knowledgeFor(norm.host) : null;
      return {
        action: action.slice(0, 200),
        method: typeof f?.method === 'string' ? f.method.toUpperCase().slice(0, 8) : 'POST',
        verdict: norm ? (known?.verdict ?? 'unknown') : 'unknown',
        note: KNOWLEDGE.forms.guidance,
      };
    })
    .slice(0, LIMITS.forms);
  const formsBlocked = forms.some((f) => f.verdict === 'blocked');
  const formsBand = forms.length ? (formsBlocked ? 'high' : KNOWLEDGE.forms.overseas_action_verdict === 'blocked' ? 'high' : 'medium') : null;

  const candidates = [dependencyBand, sizeBand, formsBand].filter((b) => b && b !== 'unknown');
  const overall = candidates.includes('high') ? 'high' : candidates.includes('medium') ? 'medium' : 'low';

  return {
    as_of: KNOWLEDGE_AS_OF,
    scope: bucket ? 'bucket' : localDir ? 'local-dir' : urlsInput.length ? 'urls' : 'unknown',
    site: typeof manifest?.site_url === 'string' ? manifest.site_url.slice(0, 200) : null,
    counts: {
      files: fileCount,
      bytes: totalBytes,
      urls: urlsInput.length,
      origins: rows.length,
      forms: forms.length,
      verdicts: counts,
    },
    bands: { size: sizeBand, pages: pageCountBand, dependencies: dependencyBand, forms: formsBand, overall },
    origins: rows,
    forms,
    urls_only_note: !bucket && !localDir && urlsInput.length
      ? 'URL-list mode measures scale only: page-level third-party references beyond the homepage may be missed. A bucket or build-output manifest gives the full picture.'
      : null,
  };
}

// --- markdown report -------------------------------------------------------

function bandLine(label, band) {
  return `- ${label}: **${band ?? 'n/a'}**`;
}

export function renderReport(a) {
  const lines = [];
  lines.push(`# China readiness assessment — ${a.site ?? '(unnamed site)'}`);
  lines.push('');
  lines.push(`Knowledge base as of ${a.as_of}. Verdicts: blocked / slow / degraded / ok / unknown.`);
  lines.push('');
  lines.push('## Cost bands (relative, not quotes)');
  lines.push(bandLine('Overall migration effort', a.bands.overall));
  lines.push(bandLine('Site size', a.bands.size));
  lines.push(bandLine('Page count', a.bands.pages));
  lines.push(bandLine('Third-party dependency work', a.bands.dependencies));
  if (a.bands.forms) lines.push(bandLine('Form rework', a.bands.forms));
  lines.push('');
  lines.push('## Third-party origins from Mainland China');
  if (!a.origins.length) {
    lines.push('No third-party origins were provided in the manifest.');
  } else {
    for (const r of a.origins) {
      const fix = r.fix ? ` — fix: ${r.fix}` : '';
      const src = r.source ? ` (ref: ${r.source})` : '';
      lines.push(`- \`${r.verdict}\` ${r.origin} (${r.refs} ref${r.refs === 1 ? '' : 's'})${fix}${src}`);
    }
  }
  if (a.forms.length) {
    lines.push('');
    lines.push('## Forms');
    for (const f of a.forms) {
      lines.push(`- \`${f.verdict}\` ${f.method} ${f.action || '(no action URL)'}`);
    }
    lines.push(`- Note: ${a.forms[0].note} (ref: ${KNOWLEDGE.forms.source})`);
  }
  if (a.urls_only_note) {
    lines.push('');
    lines.push(`> ${a.urls_only_note}`);
  }
  lines.push('');
  lines.push('Origins marked `unknown` are simply not in the knowledge base yet — not confirmed reachable. Chinaready maintains a wider tested set and can assess them, plus handle the migration end to end (ICP filing, dependency fixes, OSS + CDN delivery). https://chinaready.co/contact/');
  return lines.join('\n');
}

// --- tool entry ------------------------------------------------------------

export function assessLimitsError(manifestJsonLength) {
  if (manifestJsonLength > LIMITS.payloadChars) {
    return `Manifest too large (${manifestJsonLength} chars; limit ${LIMITS.payloadChars}). Trim the origin/URL lists.`;
  }
  return null;
}

export function validateManifest(manifest) {
  const errors = [];
  const origins = Array.isArray(manifest?.third_party_origins) ? manifest.third_party_origins : [];
  const urls = Array.isArray(manifest?.urls) ? manifest.urls : [];
  const forms = Array.isArray(manifest?.forms) ? manifest.forms : [];
  if (origins.length > LIMITS.origins) errors.push(`third_party_origins exceeds ${LIMITS.origins} entries.`);
  if (urls.length > LIMITS.urls) errors.push(`urls exceeds ${LIMITS.urls} entries.`);
  if (forms.length > LIMITS.forms) errors.push(`forms exceeds ${LIMITS.forms} entries.`);
  const mode = manifest?.bucket ? 'bucket' : manifest?.local_dir ? 'local_dir' : urls.length ? 'urls' : null;
  if (!mode) errors.push('Provide one of: bucket {provider,name,…}, local_dir {path,…}, or a non-empty urls array.');
  const provider = manifest?.bucket?.provider;
  if (manifest?.bucket && !['s3', 'gcs', 'azure', 'r2'].includes(provider)) {
    errors.push('bucket.provider must be one of: s3, gcs, azure, r2.');
  }
  if (manifest?.bucket && typeof manifest.bucket.name !== 'string' && !provider) {
    errors.push('bucket.name is required.');
  }
  for (const u of urls) {
    if (typeof u !== 'string' || !isValidHttpUrl(u)) {
      errors.push(`urls contains a non-http(s) entry: ${String(u).slice(0, 80)}`);
      break;
    }
  }
  return errors;
}

export function callAssess(args) {
  const errors = validateManifest(args);
  if (errors.length) {
    return { isError: true, content: [{ type: 'text', text: `Invalid manifest: ${errors.join(' ')}` }] };
  }
  const analysis = analyzeManifest(args);
  return {
    content: [{ type: 'text', text: renderReport(analysis) }],
    structuredContent: analysis,
  };
}
