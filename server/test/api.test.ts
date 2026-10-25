import { describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { SHEET_SIZE, type AuthResponse, type Prospect } from '@op/shared';
import { EXTENSION_ORIGIN, buildTestApp, useMemoryMongo } from './helpers.js';

useMemoryMongo();

const API = '/api/v1';
const SETTINGS = { sender: { name: 'Ada Okafor', link: 'https://gridline.example' } };
const DRAFT_REQUEST = { message: 'I build booking websites for clinics and would like to offer a free review.', dials: { tone: 'warm', length: 'short' } };
const DRAFT = { subject: 'A free booking page review', body: "Hi there,\n\nI build booking websites for clinics.\n\nIf this isn't relevant, just reply and I won't follow up.\n\nAda" };

async function register(app: ReturnType<typeof buildTestApp>['app'], email: string): Promise<AuthResponse> {
  const res = await request(app).post(`${API}/auth/register`).send({ email, password: 'correct horse battery' });
  expect(res.status).toBe(201);
  return res.body as AuthResponse;
}

/** Two users on a server with signup forced open. */
async function twoUsers() {
  const t = buildTestApp({ ALLOW_SIGNUP: 'true' });
  const a = await register(t.app, 'a@example.com');
  const b = await register(t.app, 'b@example.com');
  const as = (auth: AuthResponse) => ({ Authorization: `Bearer ${auth.accessToken}` });
  const collect = (auth: AuthResponse, emails: string[], url = 'https://clinic.example/team') =>
    request(t.app).post(`${API}/prospects/collect`).set(as(auth)).send({ url, title: 'Our team | Harbour Physio', emails });
  const list = async (auth: AuthResponse, qs = '') => (await request(t.app).get(`${API}/prospects${qs}`).set(as(auth)).expect(200)).body.items as Prospect[];
  const sheets = async (auth: AuthResponse) => (await request(t.app).get(`${API}/prospects/sheets`).set(as(auth)).expect(200)).body;
  const exportRows = async (auth: AuthResponse, qs = '') => {
    const res = await request(t.app)
      .get(`${API}/prospects/export${qs}`)
      .set(as(auth))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    return { res, rows: XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(res.body as Buffer, { type: 'buffer' }).Sheets.Prospects!) };
  };
  return { ...t, a, b, as, collect, list, sheets, exportRows };
}

const emails = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `p${from + i}@clinic.example`);

describe('health and transport', () => {
  it('answers health without auth', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get(`${API}/health`).expect(200);
    expect(res.body).toEqual({ ok: true, version: expect.any(String), db: 'up', ai: 'unchecked' });
  });

  it('sets security headers and hides the framework', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows only the extension origin', async () => {
    const { app } = buildTestApp();
    const ok = await request(app).get(`${API}/health`).set('Origin', EXTENSION_ORIGIN);
    expect(ok.headers['access-control-allow-origin']).toBe(EXTENSION_ORIGIN);
    await request(app).get(`${API}/health`).set('Origin', 'https://evil.example').expect(403);
  });

  it('requires a token on data routes', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get(`${API}/prospects`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('never leaks stack traces and rejects oversized bodies', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(60_000) }));
    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});

describe('signup flag', () => {
  it('when unset, allows only the first account', async () => {
    const { app } = buildTestApp();
    await register(app, 'first@example.com');
    const res = await request(app).post(`${API}/auth/register`).send({ email: 'second@example.com', password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
  });

  it('ALLOW_SIGNUP=false blocks even the first account', async () => {
    const { app } = buildTestApp({ ALLOW_SIGNUP: 'false' });
    await request(app).post(`${API}/auth/register`).send({ email: 'x@example.com', password: 'correct horse battery' }).expect(403);
  });

  it('ALLOW_SIGNUP=true allows more accounts', async () => {
    const { app } = buildTestApp({ ALLOW_SIGNUP: 'true' });
    await register(app, 'one@example.com');
    await register(app, 'two@example.com');
  });
});

describe('auth flow', () => {
  it('returns identical failures for a wrong password and an unknown email', async () => {
    const { app } = buildTestApp();
    await register(app, 'jane@example.com');
    const wrong = await request(app).post(`${API}/auth/login`).send({ email: 'jane@example.com', password: 'wrong password' });
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: 'nobody@example.com', password: 'wrong password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('logs in case insensitively, refreshes and logs out', async () => {
    const { app } = buildTestApp();
    await register(app, 'jane@example.com');
    const login = await request(app).post(`${API}/auth/login`).send({ email: 'JANE@example.com', password: 'correct horse battery' }).expect(200);
    const refreshed = await request(app).post(`${API}/auth/refresh`).send({ refreshToken: login.body.refreshToken }).expect(200);
    const auth = { Authorization: `Bearer ${refreshed.body.accessToken}` };
    await request(app).get(`${API}/settings`).set(auth).expect(200);
    await request(app).post(`${API}/auth/logout`).send({ refreshToken: refreshed.body.refreshToken }).expect(204);
    // Logout takes effect immediately, even though the access token has not expired yet.
    await request(app).get(`${API}/settings`).set(auth).expect(401);
    await request(app).post(`${API}/auth/refresh`).send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('rate limits login attempts', async () => {
    const { app } = buildTestApp();
    let last;
    for (let i = 0; i < 11; i++) last = await request(app).post(`${API}/auth/login`).send({ email: 'x@example.com', password: 'nope' });
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('settings', () => {
  it('stores the sender name and optional link only', async () => {
    const t = await twoUsers();
    expect((await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SETTINGS).expect(200)).body).toEqual(SETTINGS);
    expect((await request(t.app).get(`${API}/settings`).set(t.as(t.b)).expect(200)).body).toEqual({ sender: { name: null, link: null } });
  });

  it('rejects unknown fields and non http links', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send({ sender: { name: 'A', link: null, about: 'x' } }).expect(400);
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send({ sender: { name: 'A', link: 'javascript:alert(1)' } }).expect(400);
  });
});

describe('collecting emails', () => {
  it('saves each new address as not contacted, with the page it came from, and no AI call', async () => {
    const t = await twoUsers();
    const res = await t.collect(t.a, ['Lena@Clinic.example', 'sam@clinic.example']).expect(201);
    expect(res.body).toEqual({ added: 2, alreadySaved: 0 });
    const items = await t.list(t.a);
    expect(items.map((p) => p.email).sort()).toEqual(['lena@clinic.example', 'sam@clinic.example']);
    expect(items[0]).toMatchObject({ status: 'new', subject: null, sourceTitle: 'Our team | Harbour Physio', sourceUrl: 'https://clinic.example/team', sheet: 1 });
    expect(t.provider.calls).toHaveLength(0);
  });

  it('never duplicates: visiting a page again adds only new addresses', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['lena@clinic.example']).expect(201);
    expect((await t.collect(t.a, ['lena@clinic.example', 'new@clinic.example']).expect(201)).body).toEqual({ added: 1, alreadySaved: 1 });
    expect(await t.list(t.a)).toHaveLength(2);
  });

  it('validates input: real emails only, at most 50 per page, http(s) pages only, signed in only', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['not-an-email']).expect(400);
    await t.collect(t.a, emails(51)).expect(400);
    await t.collect(t.a, ['a@x.example'], 'chrome://settings').expect(400);
    await request(t.app).post(`${API}/prospects/collect`).send({ url: 'https://x.example', title: null, emails: ['a@x.example'] }).expect(401);
  });
});

describe('sheets of 200', () => {
  it('fills a sheet to 200, then starts the next', async () => {
    const t = await twoUsers();
    for (let start = 0; start < SHEET_SIZE + 5; start += 50) await t.collect(t.a, emails(Math.min(50, SHEET_SIZE + 5 - start), start)).expect(201);
    const s = await t.sheets(t.a);
    expect(s.current).toBe(2);
    expect(s.items.map((x: { number: number; total: number }) => [x.number, x.total])).toEqual([[2, 5], [1, SHEET_SIZE]]);
  });

  it('closing the current sheet early starts a new one; closing an old or empty one does nothing', async () => {
    const t = await twoUsers();
    await request(t.app).post(`${API}/prospects/sheets/close`).set(t.as(t.a)).send({ number: 1 }).expect(204);
    await t.collect(t.a, ['a@x.example']).expect(201);
    expect((await t.sheets(t.a)).current).toBe(1);
    await request(t.app).post(`${API}/prospects/sheets/close`).set(t.as(t.a)).send({ number: 1 }).expect(204);
    await t.collect(t.a, ['b@x.example']).expect(201);
    expect((await t.sheets(t.a)).items.map((x: { number: number }) => x.number)).toEqual([2, 1]);
  });

  it('exports one sheet as its own .xlsx, in collection order', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['first@x.example']).expect(201);
    await request(t.app).post(`${API}/prospects/sheets/close`).set(t.as(t.a)).send({ number: 1 });
    await t.collect(t.a, ['second@x.example', 'third@x.example']).expect(201);
    const { res, rows } = await t.exportRows(t.a, '?sheet=2');
    expect(res.headers['content-disposition']).toContain('sheet-002');
    expect(rows.map((r) => r.Email)).toEqual(['second@x.example', 'third@x.example']);
    expect(Object.keys(rows[0]!)).toEqual(['Email', 'Status', 'Date added', 'Found on', 'Source URL', 'Draft subject', 'Draft body']);
  });
});

describe('drafting a sheet', () => {
  const draftSheet = (t: Awaited<ReturnType<typeof twoUsers>>, auth: AuthResponse, n = 1, body: object = DRAFT_REQUEST) =>
    request(t.app).post(`${API}/prospects/sheets/${n}/draft`).set(t.as(auth)).send(body);

  it('needs the sender name first', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example']).expect(201);
    expect((await draftSheet(t, t.a).expect(409)).body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('writes one message from what the user wants to say, with one AI call, onto every email in the sheet', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SETTINGS).expect(200);
    await t.collect(t.a, emails(3)).expect(201);
    t.provider.reply(DRAFT);
    const res = await draftSheet(t, t.a).expect(200);
    expect(res.body).toEqual({ draft: DRAFT, updated: 3 });
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0]!.user).toContain('I build booking websites for clinics');
    expect((await t.list(t.a)).every((p) => p.status === 'drafted' && p.body === DRAFT.body)).toBe(true);
    const { rows } = await t.exportRows(t.a, '?sheet=1');
    expect(rows[0]).toMatchObject({ Status: 'drafted', 'Draft subject': DRAFT.subject, 'Draft body': DRAFT.body });
  });

  it('only touches the chosen sheet, and keeps the message on emails already sent', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SETTINGS).expect(200);
    await t.collect(t.a, ['sent@x.example', 'new@x.example']).expect(201);
    await request(t.app).post(`${API}/prospects/sheets/close`).set(t.as(t.a)).send({ number: 1 });
    await t.collect(t.a, ['other@x.example']).expect(201);
    const sent = (await t.list(t.a)).find((p) => p.email === 'sent@x.example')!;
    await request(t.app).patch(`${API}/prospects/${sent.id}`).set(t.as(t.a)).send({ status: 'sent', subject: 'Mine', body: 'My own words' }).expect(200);
    t.provider.reply(DRAFT);
    expect((await draftSheet(t, t.a, 1).expect(200)).body.updated).toBe(1);
    const all = await t.list(t.a);
    expect(all.find((p) => p.email === 'sent@x.example')).toMatchObject({ status: 'sent', subject: 'Mine' });
    expect(all.find((p) => p.email === 'other@x.example')).toMatchObject({ status: 'new', subject: null });
  });

  it('refuses an empty sheet without using the AI', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SETTINGS).expect(200);
    await draftSheet(t, t.a, 5).expect(404);
    expect(t.provider.calls).toHaveLength(0);
  });

  it('validates the message and the dials', async () => {
    const t = await twoUsers();
    await draftSheet(t, t.a, 1, { message: 'hi', dials: DRAFT_REQUEST.dials }).expect(400);
    await draftSheet(t, t.a, 1, { message: DRAFT_REQUEST.message, dials: { tone: 'warm', length: 'short', goal: 'x' } }).expect(400);
  });

  it('retries once when the draft contains a foreign link, then fails without saving and refunds the cap', async () => {
    const t = buildTestApp({ ALLOW_SIGNUP: 'true', DAILY_DRAFT_CAP: '1' });
    const auth = await register(t.app, 'cap@example.com');
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    await request(t.app).put(`${API}/settings`).set(h).send(SETTINGS).expect(200);
    await request(t.app).post(`${API}/prospects/collect`).set(h).send({ url: 'https://x.example', title: null, emails: ['a@x.example'] }).expect(201);
    const bad = { ...DRAFT, body: 'Visit https://evil.example now' };
    t.provider.reply(bad, bad);
    await request(t.app).post(`${API}/prospects/sheets/1/draft`).set(h).send(DRAFT_REQUEST).expect(502);
    expect(t.provider.calls).toHaveLength(2);
    // The failed draft did not use up the daily cap of 1.
    t.provider.reply(DRAFT);
    await request(t.app).post(`${API}/prospects/sheets/1/draft`).set(h).send(DRAFT_REQUEST).expect(200);
    const capped = await request(t.app).post(`${API}/prospects/sheets/1/draft`).set(h).send(DRAFT_REQUEST).expect(429);
    expect(capped.body.error.code).toBe('DAILY_CAP');
  });
});

describe('the saved list', () => {
  it('paginates with a cursor, filters by status and sheet, and searches literally', async () => {
    const t = await twoUsers();
    await t.collect(t.a, emails(5)).expect(201);
    const page1 = await request(t.app).get(`${API}/prospects?limit=2`).set(t.as(t.a)).expect(200);
    const page2 = await request(t.app).get(`${API}/prospects?limit=2&cursor=${page1.body.nextCursor}`).set(t.as(t.a)).expect(200);
    const page3 = await request(t.app).get(`${API}/prospects?limit=2&cursor=${page2.body.nextCursor}`).set(t.as(t.a)).expect(200);
    const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: Prospect) => p.id);
    expect(new Set(ids).size).toBe(5);
    expect(page3.body.nextCursor).toBeNull();

    await request(t.app).patch(`${API}/prospects/${ids[0]}`).set(t.as(t.a)).send({ status: 'sent' }).expect(200);
    expect((await t.list(t.a, '?status=sent')).map((p) => p.id)).toEqual([ids[0]]);
    expect(await t.list(t.a, '?sheet=1')).toHaveLength(5);
    expect(await t.list(t.a, '?q=p3@')).toHaveLength(1);
    expect(await t.list(t.a, '?q=.*')).toHaveLength(0);
  });

  it('edits a draft and rejects unknown fields', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example']).expect(201);
    const [p] = await t.list(t.a);
    expect((await request(t.app).patch(`${API}/prospects/${p!.id}`).set(t.as(t.a)).send({ subject: 'New subject' }).expect(200)).body.subject).toBe('New subject');
    await request(t.app).patch(`${API}/prospects/${p!.id}`).set(t.as(t.a)).send({ userId: 'x' }).expect(400);
    await request(t.app).patch(`${API}/prospects/${p!.id}`).set(t.as(t.a)).send({ email: 'b@x.example' }).expect(400);
  });

  it('deletes one and all', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example', 'b@x.example']).expect(201);
    const [p] = await t.list(t.a);
    await request(t.app).delete(`${API}/prospects/${p!.id}`).set(t.as(t.a)).expect(204);
    await request(t.app).delete(`${API}/prospects`).set(t.as(t.a)).expect(400);
    expect((await request(t.app).delete(`${API}/prospects?confirm=all`).set(t.as(t.a)).expect(200)).body).toEqual({ deleted: 1 });
  });

  it('neutralizes formula injection from page titles in the export', async () => {
    const t = await twoUsers();
    await request(t.app)
      .post(`${API}/prospects/collect`)
      .set(t.as(t.a))
      .send({ url: 'https://x.example', title: '=HYPERLINK("http://evil","x")', emails: ['a@x.example'] })
      .expect(201);
    expect((await t.exportRows(t.a)).rows[0]!['Found on']).toBe(`'=HYPERLINK("http://evil","x")`);
  });
});

describe('cross user isolation', () => {
  it('user B cannot read, edit, delete, draft or export user A emails', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.b)).send(SETTINGS).expect(200);
    await t.collect(t.a, ['secret@a.example']).expect(201);
    const [p] = await t.list(t.a);

    await request(t.app).get(`${API}/prospects/${p!.id}`).set(t.as(t.b)).expect(404);
    await request(t.app).patch(`${API}/prospects/${p!.id}`).set(t.as(t.b)).send({ subject: 'hijack' }).expect(404);
    await request(t.app).delete(`${API}/prospects/${p!.id}`).set(t.as(t.b)).expect(404);
    expect(await t.list(t.b)).toHaveLength(0);
    expect((await t.sheets(t.b)).items).toHaveLength(0);
    await request(t.app).post(`${API}/prospects/sheets/1/draft`).set(t.as(t.b)).send(DRAFT_REQUEST).expect(404);
    expect((await request(t.app).delete(`${API}/prospects?confirm=all`).set(t.as(t.b)).expect(200)).body.deleted).toBe(0);
    expect((await t.exportRows(t.b)).rows).toHaveLength(0);
    expect((await t.exportRows(t.b, '?sheet=1')).rows).toHaveLength(0);

    expect((await request(t.app).get(`${API}/prospects/${p!.id}`).set(t.as(t.a)).expect(200)).body.email).toBe('secret@a.example');
    expect(t.provider.calls).toHaveLength(0);
  });

  it('the same address saved by two users is two separate entries', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['shared@x.example']).expect(201);
    expect((await t.collect(t.b, ['shared@x.example']).expect(201)).body.added).toBe(1);
  });
});

describe('3 hour retention', () => {
  const HOUR = 3_600_000;
  const prospects = async () => (await import('mongoose')).default.connection.db!.collection('prospects');

  it('stamps each email to expire 3 hours after it was first saved, enforced by a TTL index', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example']).expect(201);
    const [p] = await t.list(t.a);
    expect(Date.parse(p!.expiresAt) - Date.parse(p!.createdAt)).toBeGreaterThan(3 * HOUR - 5000);
    expect(await (await prospects()).indexes()).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
  });

  it('hides expired emails at once, and saves them fresh if collected again', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example']).expect(201);
    const [old] = await t.list(t.a);
    await (await prospects()).updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await t.list(t.a)).toHaveLength(0);
    expect((await request(t.app).get(`${API}/prospects/${old!.id}`).set(t.as(t.a)).expect(404)).body.error.message).toContain('no longer saved');
    expect((await t.collect(t.a, ['a@x.example']).expect(201)).body.added).toBe(1);
  });

  it('honours PROSPECT_TTL_HOURS', async () => {
    const t = buildTestApp({ ALLOW_SIGNUP: 'true', PROSPECT_TTL_HOURS: '1' });
    const auth = await register(t.app, 'ttl@example.com');
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    await request(t.app).post(`${API}/prospects/collect`).set(h).send({ url: 'https://x.example', title: null, emails: ['a@x.example'] }).expect(201);
    const [p] = (await request(t.app).get(`${API}/prospects`).set(h)).body.items as Prospect[];
    expect(Date.parse(p!.expiresAt) - Date.parse(p!.createdAt)).toBeLessThanOrEqual(HOUR + 5000);
  });
});

describe('account deletion', () => {
  it('requires the password and deletes all of the user data', async () => {
    const t = await twoUsers();
    await t.collect(t.a, ['a@x.example']).expect(201);
    await t.collect(t.b, ['a@x.example']).expect(201);
    await request(t.app).delete(`${API}/account`).set(t.as(t.a)).send({ password: 'wrong password' }).expect(401);
    await request(t.app).delete(`${API}/account`).set(t.as(t.a)).send({ password: 'correct horse battery' }).expect(204);
    await request(t.app).get(`${API}/settings`).set(t.as(t.a)).expect(401);
    await request(t.app).post(`${API}/auth/login`).send({ email: 'a@example.com', password: 'correct horse battery' }).expect(401);
    expect(await t.list(t.b)).toHaveLength(1);
    const mongoose = (await import('mongoose')).default;
    expect(await mongoose.connection.db!.collection('prospects').countDocuments()).toBe(1);
  });
});
