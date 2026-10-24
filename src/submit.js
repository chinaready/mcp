// Copyright (c) 2026 Chinaready. All rights reserved.
// submit_baseline — explicit opt-in lead submission. Sends only the fields
// the user provides plus the assessment summary; nothing is transmitted
// unless this tool is called.

const CONTACT_ENDPOINT = 'https://chinaready.co/api/contact/mcp';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_SUMMARY = 4000;

export function validateSubmission(args) {
  const errors = [];
  const email = String(args?.email ?? '').trim();
  if (!EMAIL_RE.test(email)) errors.push('email must be a valid address.');
  const siteUrl = String(args?.site_url ?? '').trim();
  if (siteUrl) {
    try {
      const u = new URL(siteUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    } catch {
      errors.push('site_url must be an http(s) URL.');
    }
  }
  const summary = args?.summary;
  if (summary !== undefined && typeof summary !== 'string') errors.push('summary must be a string.');
  if (typeof summary === 'string' && summary.length > MAX_SUMMARY) errors.push(`summary exceeds ${MAX_SUMMARY} characters.`);
  return errors;
}

export async function callSubmitBaseline(args, ctx = {}) {
  const { env, fetchImpl = fetch } = ctx;
  const errors = validateSubmission(args);
  if (errors.length) {
    return { isError: true, content: [{ type: 'text', text: `Invalid submission: ${errors.join(' ')}` }] };
  }

  const secret = typeof env?.MCP_LEAD_SHARED_KEY === 'string' ? env.MCP_LEAD_SHARED_KEY.trim() : '';
  if (!secret) {
    return { isError: true, content: [{ type: 'text', text: 'Submission endpoint is not configured on this deployment (missing MCP_LEAD_SHARED_KEY); email Chinaready directly at https://chinaready.co/contact/.' }] };
  }

  let response;
  try {
    response = await fetchImpl(CONTACT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
        'X-Client-IP': ctx.ip || 'unknown',
      },
      body: JSON.stringify({
        name: String(args?.name ?? '').trim().slice(0, 120) || 'MCP assessment lead',
        email: String(args.email).trim().slice(0, 200),
        site_url: String(args?.site_url ?? '').trim().slice(0, 200) || undefined,
        summary: typeof args?.summary === 'string' ? args.summary.slice(0, MAX_SUMMARY) : undefined,
      }),
    });
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'Could not reach the submission endpoint (network error). Retry shortly, or email https://chinaready.co/contact/.' }] };
  }

  if (!response.ok) {
    return { isError: true, content: [{ type: 'text', text: `Submission failed (HTTP ${response.status}). Retry shortly, or email https://chinaready.co/contact/.` }] };
  }
  const payload = await response.json().catch(() => null);
  const caseNumber = payload?.case_number ?? null;

  return {
    content: [{
      type: 'text',
      text: `Received — thank you.${caseNumber ? ` Your reference is ${caseNumber}.` : ''} Chinaready will review the baseline and reply to ${String(args.email).trim()} within one business day. Nothing further is sent from this session unless you call this tool again.`,
    }],
    structuredContent: { submitted: true, case_number: caseNumber },
  };
}
