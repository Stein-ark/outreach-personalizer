/**
 * Draft generation. Assembles the prompt from the five inputs (base instructions, voice samples, dials,
 * confirmed prospect fields, sender profile), validates the model output and applies output safety checks
 * before anything is saved or shown.
 */
import { DraftOutput, isSenderProfileComplete, normalizeUrl, type DraftRequest, type SenderProfile } from '@op/shared';
import { AppError } from '../lib/errors.js';
import type { AiGateway } from '../ai/gateway.js';
import type { BaseInstructions } from '../ai/baseInstructions.js';
import { DRAFT_JSON_SCHEMA, buildDraftPrompt } from '../ai/prompts.js';
import { ProviderError } from '../ai/provider.js';
import { safeJson } from './extract.js';

export interface DraftContext {
  gateway: AiGateway;
  base: BaseInstructions;
  maxOutputTokens: number;
}

export interface DraftInputs {
  request: DraftRequest;
  sender: SenderProfile;
  footer: string | null;
  voiceSamples: string[];
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const EMAIL_PATTERN = /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[a-z]{2,}/i;
const PLACEHOLDER_PATTERN = /\[[A-Z][A-Za-z ]{1,30}\]|\{[a-z_ ]{2,30}\}/;

/** Returns a reason when the draft breaks an output rule, or null when it is acceptable. */
export function findOutputProblem(draft: DraftOutput, sender: SenderProfile): string | null {
  const allowed = sender.link ? normalizeUrl(sender.link) : null;
  const text = `${draft.subject}\n${draft.body}`;
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const candidate = normalizeUrl(cleaned.startsWith('www.') ? `https://${cleaned}` : cleaned);
    const allowedNoScheme = allowed?.replace(/^https?:\/\//, '');
    if (!candidate || !allowedNoScheme || candidate.replace(/^https?:\/\//, '') !== allowedNoScheme) return 'unexpected URL';
  }
  if (EMAIL_PATTERN.test(text)) return 'email address in draft';
  if (PLACEHOLDER_PATTERN.test(text)) return 'placeholder left in draft';
  return null;
}

export function assertDraftable(request: DraftRequest, sender: SenderProfile): void {
  if (!isSenderProfileComplete(sender)) {
    throw new AppError(409, 'PROFILE_INCOMPLETE', 'Complete your sender profile (name, organisation and what you offer) in Settings first.');
  }
  const f = request.fields;
  if (!(f.name || f.company) || !(f.detail || f.bio)) {
    throw new AppError(400, 'VALIDATION', 'Add a name or company and at least one real detail or bio before drafting.');
  }
}

export async function generateDraft(ctx: DraftContext, inputs: DraftInputs): Promise<DraftOutput> {
  const prompt = buildDraftPrompt({
    base: ctx.base,
    sender: inputs.sender,
    fields: inputs.request.fields,
    dials: inputs.request.dials,
    voiceSamples: inputs.voiceSamples,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await ctx.gateway.completeJson('draft', {
        ...prompt,
        schemaName: 'outreach_draft',
        schema: DRAFT_JSON_SCHEMA,
        maxOutputTokens: ctx.maxOutputTokens,
      });
      const parsed = DraftOutput.safeParse(safeJson(result.content));
      if (parsed.success && findOutputProblem(parsed.data, inputs.sender) === null) {
        return withFooter(parsed.data, inputs.footer);
      }
    } catch (err) {
      if (!(err instanceof ProviderError && err.kind === 'invalid_output')) throw err;
    }
  }
  throw new AppError(502, 'AI_FAILED', 'The AI returned a draft that did not pass checks. Try again.');
}

/** The footer is appended after generation so the model never sees or rewrites it. */
function withFooter(draft: DraftOutput, footer: string | null): DraftOutput {
  return footer ? { ...draft, body: `${draft.body}\n\n${footer}` } : draft;
}
