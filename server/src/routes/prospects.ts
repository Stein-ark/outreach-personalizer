/** Saved prospects: list, read, edit, delete, delete all, and the .xlsx export. */
import { Router } from 'express';
import { DeleteAllQuery, ProspectFilter, ProspectListQuery, ProspectPatch, objectId, type DeletedCount, type ProspectList } from '@op/shared';
import { parse } from '../lib/validate.js';
import { userIdOf } from '../auth/middleware.js';
import {
  deleteAllProspects,
  deleteProspect,
  getProspect,
  listProspects,
  prospectsForExport,
  updateProspect,
} from '../services/prospects.js';
import { buildProspectWorkbook } from '../services/spreadsheet.js';

export function prospectRoutes(): Router {
  const r = Router();

  r.get('/prospects', async (req, res) => {
    const body: ProspectList = await listProspects(userIdOf(req), parse(ProspectListQuery, req.query));
    res.json(body);
  });

  // Registered before /prospects/:id so "export" is never treated as an id.
  r.get('/prospects/export', async (req, res) => {
    const rows = await prospectsForExport(userIdOf(req), parse(ProspectFilter, req.query));
    const file = buildProspectWorkbook(rows);
    const stamp = new Date().toISOString().slice(0, 10);
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
