/**
 * Drafting a sheet: one message for every email in it, written from what the user wants to convey. The emails are
 * all that is known about the recipients, so the message is the same for each (one AI call per sheet). The output
 * is validated and checked before anything is saved.
 */
import { DraftOutput, normalizeUrl, type SheetDraftRequest, type SenderProfile } from '@op/shared';
import { AppError } from '../lib/errors.js';
import type { AiGateway } from '../ai/gateway.js';
import type { BaseInstructions } from '../ai/baseInstructions.js';
import { DRAFT_JSON_SCHEMA, buildSheetPrompt } from '../ai/prompts.js';
import { ProviderError } from '../ai/provider.js';

export interface DraftContext {
  gateway: AiGateway;
  base: BaseInstructions;
  maxOutputTokens: number;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const EMAIL_PATTERN = /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[a-z]{2,}/i;
const PLACEHOLDER_PATTERN = /\[[A-Z][A-Za-z ]{1,30}\]|\{[a-z_ ]{2,30}\}/;

/** Returns a reason when the draft breaks an output rule, or null when it is acceptable. */
export function findOutputProblem(draft: DraftOutput, sender: SenderProfile): string | null {
  const allowed = sender.link ? normalizeUrl(sender.link)?.replace(/^https?:\/\//, '') : null;
  const text = `${draft.subject}\n${draft.body}`;
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const candidate = normalizeUrl(cleaned.startsWith('www.') ? `https://${cleaned}` : cleaned);
    if (!candidate || !allowed || candidate.replace(/^https?:\/\//, '') !== allowed) return 'unexpected URL';
  }
  if (EMAIL_PATTERN.test(text)) return 'email address in draft';
  if (PLACEHOLDER_PATTERN.test(text)) return 'placeholder left in draft';
  return null;
}

export function assertDraftable(sender: SenderProfile): void {
  if (!sender.name) throw new AppError(409, 'PROFILE_INCOMPLETE', 'Add your name in Settings first, so the message can be signed.');
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export async function generateSheetDraft(ctx: DraftContext, sender: SenderProfile, request: SheetDraftRequest): Promise<DraftOutput> {
  const prompt = buildSheetPrompt({ base: ctx.base, sender, message: request.message, dials: request.dials });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await ctx.gateway.completeJson('draft', {
        ...prompt,
        schemaName: 'outreach_draft',
        schema: DRAFT_JSON_SCHEMA,
        maxOutputTokens: ctx.maxOutputTokens,
      });
      const parsed = DraftOutput.safeParse(safeJson(result.content));
      if (parsed.success && findOutputProblem(parsed.data, sender) === null) return parsed.data;
    } catch (err) {
      if (!(err instanceof ProviderError && err.kind === 'invalid_output')) throw err;
    }
  }
  throw new AppError(502, 'AI_FAILED', 'The AI returned a draft that did not pass checks. Try again.');
}
