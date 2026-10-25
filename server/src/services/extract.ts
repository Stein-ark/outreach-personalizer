/**
 * Field extraction. The extension already ran deterministic extraction (JSON-LD, meta tags, mailto links)
 * and sends those results as hints. The model is only asked to fill the gaps, and every model value that can be
 * checked against the source text is checked, so a hallucinated name, company or email is dropped.
 */
import { FIELD_KEYS, ProspectFields, type ExtractRequest, type ExtractResponse, type FieldKey, type FieldOrigin } from '@op/shared';
import { AppError } from '../lib/errors.js';
import type { AiGateway } from '../ai/gateway.js';
import { EXTRACT_JSON_SCHEMA, buildExtractPrompt } from '../ai/prompts.js';
import { ProviderError } from '../ai/provider.js';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

/** True when every word of value appears in the haystack, ignoring case and spacing. */
function appearsIn(value: string, haystack: string): boolean {
  return norm(value)
    .split(' ')
    .every((word) => haystack.includes(word));
}

/** Drops model values that are not supported by the source. Email must appear literally. */
export function verifyAgainstSource(fields: ProspectFields, req: ExtractRequest): ProspectFields {
  const haystack = norm(`${req.title ?? ''} ${req.text}`);
  const literalEmails = new Set([...req.mailtos.map((m) => m.toLowerCase()), ...(req.text.match(/[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[a-z]{2,}/gi) ?? []).map((m) => m.toLowerCase())]);
  return {
    ...fields,
    name: fields.name && appearsIn(fields.name, haystack) ? fields.name : null,
    company: fields.company && appearsIn(fields.company, haystack) ? fields.company : null,
    email: fields.email && literalEmails.has(fields.email.toLowerCase()) ? fields.email : null,
  };
}

export async function extractFields(gateway: AiGateway, req: ExtractRequest, maxOutputTokens: number): Promise<ExtractResponse> {
  const hints = verifyAgainstSource(req.hints, req);
  const missing = FIELD_KEYS.filter((k) => hints[k] === null);
  const origins = Object.fromEntries(FIELD_KEYS.map((k) => [k, hints[k] === null ? 'none' : 'page'])) as Record<FieldKey, FieldOrigin>;
  if (missing.length === 0) return { fields: hints, origins, aiUsed: false };

  const prompt = buildExtractPrompt({ mode: req.mode, title: req.title, url: req.url, text: req.text, hints });
  const ai = await completeFields(gateway, prompt, maxOutputTokens);
  const checked = verifyAgainstSource(ai, req);

  const fields = { ...hints };
  for (const key of missing) {
    if (checked[key] !== null) {
      fields[key] = checked[key];
      origins[key] = 'ai';
    }
  }
  return { fields, origins, aiUsed: true };
}

/** One call, one retry on invalid output, then a clear error. */
async function completeFields(gateway: AiGateway, prompt: { system: string; user: string }, maxOutputTokens: number): Promise<ProspectFields> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await gateway.completeJson('extract', {
        ...prompt,
        schemaName: 'prospect_fields',
        schema: EXTRACT_JSON_SCHEMA,
        maxOutputTokens,
      });
      const parsed = ProspectFields.safeParse(safeJson(result.content));
      if (parsed.success) return parsed.data;
    } catch (err) {
      if (!(err instanceof ProviderError && err.kind === 'invalid_output')) throw err;
    }
  }
  throw new AppError(502, 'AI_FAILED', 'The AI could not read this page. You can still fill the fields in by hand.');
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
