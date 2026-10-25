/** Saved emails: collect, list, edit, delete, sheets, drafting a sheet, and the .xlsx export. */
import { Router } from 'express';
import {
  CloseSheetRequest,
  CollectRequest,
  DeleteAllQuery,
  ProspectFilter,
  ProspectListQuery,
  ProspectPatch,
  SheetDraftRequest,
  objectId,
  type CollectResponse,
  type DeletedCount,
  type ProspectList,
  type SheetDraftResponse,
  type SheetList,
} from '@op/shared';
import { parse } from '../lib/validate.js';
import { userIdOf } from '../auth/middleware.js';
import {
  applySheetDraft,
  collectEmails,
  countDraftable,
  deleteAllProspects,
  deleteProspect,
  getProspect,
  listProspects,
  prospectsForExport,
  updateProspect,
} from '../services/prospects.js';
import { buildProspectWorkbook } from '../services/spreadsheet.js';
import { closeSheet, listSheets } from '../services/sheets.js';
import { assertDraftable, generateSheetDraft } from '../services/draft.js';
import { consumeDaily, refundDaily } from '../services/usage.js';
import { loadUser, settingsOf } from './account.js';
import { AppError } from '../lib/errors.js';
import type { AppContext } from '../context.js';

export function prospectRoutes(ctx: AppContext): Router {
  const r = Router();

  /** Emails found on one page (automatic collection, or a click on the extension icon). No page text, no AI. */
  r.post('/prospects/collect', ctx.limits.collect, async (req, res) => {
    const body: CollectResponse = await collectEmails(userIdOf(req), parse(CollectRequest, req.body), ctx.env.PROSPECT_TTL_HOURS * 3_600_000);
    res.status(201).json(body);
  });

  /** Writes one message from what the user wants to say and puts it on every not yet contacted email in the sheet. */
  r.post('/prospects/sheets/:number/draft', ctx.limits.ai, async (req, res) => {
    const sheet = parse(CloseSheetRequest.shape.number, Number(req.params.number));
    const request = parse(SheetDraftRequest, req.body);
    const userId = userIdOf(req);
    const { sender } = settingsOf(await loadUser(userId));
    assertDraftable(sender);
    if ((await countDraftable(userId, sheet)) === 0) throw new AppError(404, 'NOT_FOUND', 'This sheet has no emails left to draft.');
    await consumeDaily(userId, 'draft', ctx.env.DAILY_DRAFT_CAP);
    let draft;
    try {
      draft = await generateSheetDraft({ gateway: ctx.gateway, base: ctx.base, maxOutputTokens: ctx.env.AI_MAX_OUTPUT_TOKENS_DRAFT }, sender, request);
    } catch (err) {
      await refundDaily(userId, 'draft');
      throw err;
    }
    const updated = await applySheetDraft(userId, sheet, {
      draft,
      dials: request.dials,
      baseInstructionsVersion: ctx.base.version,
      model: ctx.gateway.model,
    });
    const body: SheetDraftResponse = { draft, updated };
    res.json(body);
  });

  // Registered before /prospects/:id so "sheets" is never treated as an id.
  r.get('/prospects/sheets', async (req, res) => {
    const body: SheetList = await listSheets(userIdOf(req));
    res.json(body);
  });

  r.post('/prospects/sheets/close', async (req, res) => {
    await closeSheet(userIdOf(req), parse(CloseSheetRequest, req.body).number);
    res.status(204).end();
  });

  r.get('/prospects', async (req, res) => {
    const body: ProspectList = await listProspects(userIdOf(req), parse(ProspectListQuery, req.query));
    res.json(body);
  });

  // Registered before /prospects/:id so "export" is never treated as an id.
  r.get('/prospects/export', async (req, res) => {
    const filter = parse(ProspectFilter, req.query);
    const file = buildProspectWorkbook(await prospectsForExport(userIdOf(req), filter));
    const stamp = filter.sheet ? `sheet-${String(filter.sheet).padStart(3, '0')}` : new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="prospects-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      })
      .send(file);
  });

  r.get('/prospects/:id', async (req, res) => {
    res.json(await getProspect(userIdOf(req), parse(objectId, req.params.id)));
  });

  r.patch('/prospects/:id', async (req, res) => {
    res.json(await updateProspect(userIdOf(req), parse(objectId, req.params.id), parse(ProspectPatch, req.body)));
  });

  r.delete('/prospects/:id', async (req, res) => {
    await deleteProspect(userIdOf(req), parse(objectId, req.params.id));
    res.status(204).end();
  });

  r.delete('/prospects', async (req, res) => {
    parse(DeleteAllQuery, req.query);
    const body: DeletedCount = { deleted: await deleteAllProspects(userIdOf(req)) };
    res.json(body);
  });

  return r;
}
