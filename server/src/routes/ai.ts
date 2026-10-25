/** POST /extract and POST /draft, the two routes that call the AI. Both are capped per user per day. */
import { Router } from 'express';
import { Types } from 'mongoose';
import { DraftRequest, ExtractRequest, type DraftResponse } from '@op/shared';
import { VoiceSample } from '../db/models.js';
import { parse } from '../lib/validate.js';
import { userIdOf } from '../auth/middleware.js';
import { assertDraftable, generateDraft } from '../services/draft.js';
import { extractFields } from '../services/extract.js';
import { saveDraftedProspect } from '../services/prospects.js';
import { consumeDaily, refundDaily } from '../services/usage.js';
import { loadUser, settingsOf } from './account.js';
import type { AppContext } from '../context.js';

export function aiRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post('/extract', ctx.limits.ai, async (req, res) => {
    const request = parse(ExtractRequest, req.body);
    const userId = userIdOf(req);
    await consumeDaily(userId, 'extract', ctx.env.DAILY_EXTRACT_CAP);
    try {
      res.json(await extractFields(ctx.gateway, request, ctx.env.AI_MAX_OUTPUT_TOKENS_EXTRACT));
    } catch (err) {
      await refundDaily(userId, 'extract');
      throw err;
    }
  });

  r.post('/draft', ctx.limits.ai, async (req, res) => {
    const request = parse(DraftRequest, req.body);
    const userId = userIdOf(req);
    const { sender, footer } = settingsOf(await loadUser(userId));
    assertDraftable(request, sender);
    await consumeDaily(userId, 'draft', ctx.env.DAILY_DRAFT_CAP);
    let draft;
    try {
      const samples = await VoiceSample.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: 1 }).limit(3).lean();
      draft = await generateDraft(
        { gateway: ctx.gateway, base: ctx.base, maxOutputTokens: ctx.env.AI_MAX_OUTPUT_TOKENS_DRAFT },
        { request, sender, footer, voiceSamples: samples.map((s) => s.text) },
      );
    } catch (err) {
      await refundDaily(userId, 'draft');
      throw err;
    }
    const prospect = await saveDraftedProspect(userId, {
      request,
      draft,
      baseInstructionsVersion: ctx.base.version,
      model: ctx.gateway.model,
    });
    const body: DraftResponse = { draft, prospect };
    res.json(body);
  });

  return r;
}
