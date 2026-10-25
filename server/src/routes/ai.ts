/** POST /extract and POST /draft, the two routes that call the AI. Both are capped per user per day. */
import { Router } from 'express';
import { Types } from 'mongoose';
import { DraftRequest, ExtractRequest, type DraftResponse } from '@op/shared';
import { VoiceSample } from '../db/models.js';
import { parse } from '../lib/validate.js';
import { isDbConnected, isDbUnavailable } from '../lib/dbStatus.js';
import { userIdOf } from '../auth/middleware.js';
import { assertDraftable, generateDraft } from '../services/draft.js';
import { extractFields } from '../services/extract.js';
import { saveDraftedProspect } from '../services/prospects.js';
import { consumeDaily, refundDaily } from '../services/usage.js';
import { loadUser, settingsOf } from './account.js';
import type { AppContext } from '../context.js';

export function aiRoutes(ctx: AppContext): Router {
  const r = Router();

  /**
   * Daily caps live in the database. If it is unreachable the cap is skipped (logged) rather than blocking the AI,
   * and the shared in-process limiter still protects the provider quota.
   */
  const tolerant = (what: string) => (err: unknown) => {
    if (!isDbUnavailable(err)) throw err;
    ctx.logger.warn({ event: 'usage_degraded', what }, 'database unavailable, daily cap not applied');
  };

  r.post('/extract', ctx.limits.ai, async (req, res) => {
    const request = parse(ExtractRequest, req.body);
    const userId = userIdOf(req);
    // Skipped entirely while the database is down, so extraction never waits on it.
    const counted = isDbConnected();
    if (counted) await consumeDaily(userId, 'extract', ctx.env.DAILY_EXTRACT_CAP).catch(tolerant('extract'));
    else ctx.logger.warn({ event: 'usage_degraded', what: 'extract' }, 'database unavailable, daily cap not applied');
    try {
      res.json(await extractFields(ctx.gateway, request, ctx.env.AI_MAX_OUTPUT_TOKENS_EXTRACT));
    } catch (err) {
      if (counted) await refundDaily(userId, 'extract').catch(tolerant('extract refund'));
      throw err;
    }
  });

  r.post('/draft', ctx.limits.ai, async (req, res) => {
    const request = parse(DraftRequest, req.body);
    const userId = userIdOf(req);
    const { sender, footer } = settingsOf(await loadUser(userId));
    assertDraftable(request, sender);
    await consumeDaily(userId, 'draft', ctx.env.DAILY_DRAFT_CAP).catch(tolerant('draft'));
    let draft;
    try {
      const samples = await VoiceSample.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: 1 }).limit(3).lean();
      draft = await generateDraft(
        { gateway: ctx.gateway, base: ctx.base, maxOutputTokens: ctx.env.AI_MAX_OUTPUT_TOKENS_DRAFT },
        { request, sender, footer, voiceSamples: samples.map((s) => s.text) },
      );
    } catch (err) {
      await refundDaily(userId, 'draft').catch(tolerant('draft refund'));
      throw err;
    }
    // The draft already exists. If saving fails because the database is unreachable, it is still returned so the user
    // can copy it, with prospect null to say it was not saved.
    let prospect = null;
    try {
      prospect = await saveDraftedProspect(userId, {
        request,
        draft,
        baseInstructionsVersion: ctx.base.version,
        model: ctx.gateway.model,
        ttlMs: ctx.env.PROSPECT_TTL_HOURS * 3_600_000,
      });
    } catch (err) {
      if (!isDbUnavailable(err)) throw err;
      ctx.logger.warn({ event: 'draft_not_saved' }, 'database unavailable, returning unsaved draft');
    }
    const body: DraftResponse = { draft, prospect };
    res.json(body);
  });

  return r;
}
