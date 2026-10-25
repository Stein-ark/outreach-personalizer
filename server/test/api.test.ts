import { describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { EMPTY_FIELDS, type AuthResponse, type Prospect } from '@op/shared';
import { EXTENSION_ORIGIN, buildTestApp, useMemoryMongo } from './helpers.js';

useMemoryMongo();

const API = '/api/v1';
const SENDER = {
  sender: { name: 'Ada Founder', role: 'CEO', organisation: 'Gridline', offer: 'Raising a seed round for grid storage software.', link: 'https://gridline.example' },
  defaultDials: { tone: 'warm', length: 'short', goal: 'book_call' },
  footer: 'Not relevant? Reply "no" and I will not follow up.',
};
const FIELDS = { ...EMPTY_FIELDS, name: 'Jane Investor', company: 'Northwind Ventures', detail: 'Led the seed round in VoltCo' };
const DRAFT = { subject: 'Your VoltCo seed round', body: 'Hi Jane,\n\nSaw you led VoltCo.\n\nAda', detailUsed: 'Led the seed round in VoltCo' };

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
  return { ...t, a, b, as };
}

async function draftFor(t: Awaited<ReturnType<typeof twoUsers>>, auth: AuthResponse, url: string | null, fields = FIELDS): Promise<Prospect> {
  await request(t.app).put(`${API}/settings`).set(t.as(auth)).send(SENDER).expect(200);
  t.provider.reply(DRAFT);
  const res = await request(t.app)
    .post(`${API}/draft`)
    .set(t.as(auth))
    .send({ fields, source: { mode: url ? 'page' : 'paste', url, title: 'Jane' }, dials: SENDER.defaultDials });
  expect(res.status).toBe(200);
  return (res.body as { prospect: Prospect }).prospect;
}

describe('health and transport', () => {
  it('answers health without auth', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get(`${API}/health`).expect(200);
    expect(res.body).toEqual({ ok: true, version: expect.any(String) });
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
    const bad = await request(app).get(`${API}/health`).set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
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
    const res = await request(app).post(`${API}/auth/register`).send({ email: 'x@example.com', password: 'correct horse battery' });
    expect(res.status).toBe(403);
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
    expect(unknown.status).toBe(401);
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

describe('settings and voice samples', () => {
  it('stores the sender profile and caps voice samples at 3', async () => {
    const t = await twoUsers();
    const put = await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SENDER).expect(200);
    expect(put.body.sender.name).toBe('Ada Founder');
    const sample = { text: 'Hi Sam, I read your post on grid storage and wanted to share what we are building.' };
    for (let i = 0; i < 3; i++) await request(t.app).post(`${API}/voice-samples`).set(t.as(t.a)).send(sample).expect(201);
    const fourth = await request(t.app).post(`${API}/voice-samples`).set(t.as(t.a)).send(sample);
    expect(fourth.status).toBe(409);
    const list = await request(t.app).get(`${API}/voice-samples`).set(t.as(t.a)).expect(200);
    expect(list.body.items).toHaveLength(3);
    await request(t.app).delete(`${API}/voice-samples/${list.body.items[0].id}`).set(t.as(t.b)).expect(404);
    await request(t.app).delete(`${API}/voice-samples/${list.body.items[0].id}`).set(t.as(t.a)).expect(204);
  });

  it('rejects a sender link that is not http(s)', async () => {
    const t = await twoUsers();
    const res = await request(t.app)
      .put(`${API}/settings`)
      .set(t.as(t.a))
      .send({ ...SENDER, sender: { ...SENDER.sender, link: 'javascript:alert(1)' } });
    expect(res.status).toBe(400);
  });
});

describe('POST /extract', () => {
  const body = {
    mode: 'page',
    url: 'https://northwind.example/team/jane',
    title: 'Jane Investor | Northwind Ventures',
    text: 'Jane Investor is a partner at Northwind Ventures. She led the seed round in VoltCo. Reach her at jane@northwind.example.',
    hints: { ...EMPTY_FIELDS, name: 'Jane Investor' },
    mailtos: [],
  };

  it('keeps page fields, fills gaps from the model and drops unsupported values', async () => {
    const t = await twoUsers();
    t.provider.reply({ name: 'Someone Else', role: 'Partner', company: 'Northwind Ventures', bio: 'Partner at Northwind.', detail: 'Led the seed round in VoltCo', email: 'guess@northwind.example' });
    const res = await request(t.app).post(`${API}/extract`).set(t.as(t.a)).send(body).expect(200);
    expect(res.body.fields).toEqual({
      name: 'Jane Investor',
      role: 'Partner',
      company: 'Northwind Ventures',
      bio: 'Partner at Northwind.',
      detail: 'Led the seed round in VoltCo',
      email: null,
    });
    expect(res.body.origins).toMatchObject({ name: 'page', role: 'ai', email: 'none' });
    // The page text reached the model only inside the delimited data block.
    expect(t.provider.calls[0]!.system).not.toContain('Jane Investor is a partner');
  });

  it('retries once on invalid model output, then fails clearly', async () => {
    const t = await twoUsers();
    t.provider.reply({ wrong: true }, { also: 'wrong' });
    const res = await request(t.app).post(`${API}/extract`).set(t.as(t.a)).send(body);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_FAILED');
    expect(t.provider.calls).toHaveLength(2);
  });

  it('rejects text over the cap', async () => {
    const t = await twoUsers();
    await request(t.app).post(`${API}/extract`).set(t.as(t.a)).send({ ...body, text: 'x'.repeat(6001) }).expect(400);
  });
});

describe('POST /draft', () => {
  it('requires a complete sender profile', async () => {
    const t = await twoUsers();
    const res = await request(t.app)
      .post(`${API}/draft`)
      .set(t.as(t.a))
      .send({ fields: FIELDS, source: { mode: 'paste', url: null, title: null }, dials: SENDER.defaultDials });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('drafts, appends the footer, records the instructions version and saves the prospect', async () => {
    const t = await twoUsers();
    const prospect = await draftFor(t, t.a, 'https://northwind.example/team/jane?utm_source=x');
    expect(prospect).toMatchObject({
      status: 'drafted',
      sourceUrl: 'https://northwind.example/team/jane',
      detailUsed: DRAFT.detailUsed,
      model: 'test-model',
      baseInstructionsVersion: expect.stringMatching(/\d{4}-\d{2}-\d{2}/),
    });
    expect(prospect.body.endsWith(SENDER.footer)).toBe(true);
    expect(t.provider.calls[0]!.user).not.toContain(SENDER.footer);
  });

  it('updates the existing prospect when the same page is drafted again', async () => {
    const t = await twoUsers();
    const first = await draftFor(t, t.a, 'https://northwind.example/team/jane');
    const second = await draftFor(t, t.a, 'https://northwind.example/team/jane#bio');
    expect(second.id).toBe(first.id);
    const list = await request(t.app).get(`${API}/prospects`).set(t.as(t.a)).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('never deduplicates pasted text without a URL', async () => {
    const t = await twoUsers();
    await draftFor(t, t.a, null);
    await draftFor(t, t.a, null);
    const list = await request(t.app).get(`${API}/prospects`).set(t.as(t.a)).expect(200);
    expect(list.body.items).toHaveLength(2);
  });

  it('retries a draft that contains a foreign URL and fails after the second bad one', async () => {
    const t = await twoUsers();
    await request(t.app).put(`${API}/settings`).set(t.as(t.a)).send(SENDER).expect(200);
    const bad = { ...DRAFT, body: 'Visit https://evil.example now' };
    t.provider.reply(bad, bad);
    const res = await request(t.app)
      .post(`${API}/draft`)
      .set(t.as(t.a))
      .send({ fields: FIELDS, source: { mode: 'paste', url: null, title: null }, dials: SENDER.defaultDials });
    expect(res.status).toBe(502);
    expect(t.provider.calls).toHaveLength(2);
  });

  it('enforces the daily draft cap and refunds failed drafts', async () => {
    const t = buildTestApp({ ALLOW_SIGNUP: 'true', DAILY_DRAFT_CAP: '1' });
    const auth = await register(t.app, 'cap@example.com');
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    await request(t.app).put(`${API}/settings`).set(h).send(SENDER).expect(200);
    const send = () =>
      request(t.app).post(`${API}/draft`).set(h).send({ fields: FIELDS, source: { mode: 'paste', url: null, title: null }, dials: SENDER.defaultDials });

    t.provider.reply({ bad: 1 }, { bad: 2 });
    expect((await send()).status).toBe(502);
    t.provider.reply(DRAFT);
    expect((await send()).status).toBe(200);
    const capped = await send();
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('DAILY_CAP');
    expect(capped.body.error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('prospects', () => {
  it('paginates with a cursor, filters by status and searches literally', async () => {
    const t = await twoUsers();
    for (let i = 0; i < 5; i++) await draftFor(t, t.a, `https://example.com/p${i}`, { ...FIELDS, name: `Person ${i}` });
    const page1 = await request(t.app).get(`${API}/prospects?limit=2`).set(t.as(t.a)).expect(200);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await request(t.app).get(`${API}/prospects?limit=2&cursor=${page1.body.nextCursor}`).set(t.as(t.a)).expect(200);
    const page3 = await request(t.app).get(`${API}/prospects?limit=2&cursor=${page2.body.nextCursor}`).set(t.as(t.a)).expect(200);
    const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: Prospect) => p.id);
    expect(new Set(ids).size).toBe(5);
    expect(page3.body.nextCursor).toBeNull();

    await request(t.app).patch(`${API}/prospects/${ids[0]}`).set(t.as(t.a)).send({ status: 'sent' }).expect(200);
    const sent = await request(t.app).get(`${API}/prospects?status=sent`).set(t.as(t.a)).expect(200);
    expect(sent.body.items.map((p: Prospect) => p.id)).toEqual([ids[0]]);

    const found = await request(t.app).get(`${API}/prospects?q=person 3`).set(t.as(t.a)).expect(200);
    expect(found.body.items).toHaveLength(1);
    const regex = await request(t.app).get(`${API}/prospects?q=.*`).set(t.as(t.a)).expect(200);
    expect(regex.body.items).toHaveLength(0);
  });

  it('edits fields and the draft', async () => {
    const t = await twoUsers();
    const p = await draftFor(t, t.a, 'https://example.com/x');
    const res = await request(t.app).patch(`${API}/prospects/${p.id}`).set(t.as(t.a)).send({ subject: 'New subject', email: 'Jane@Example.com' }).expect(200);
    expect(res.body).toMatchObject({ subject: 'New subject', email: 'jane@example.com' });
    await request(t.app).patch(`${API}/prospects/${p.id}`).set(t.as(t.a)).send({ userId: 'x' }).expect(400);
  });

  it('exports an xlsx file honouring filters', async () => {
    const t = await twoUsers();
    const p = await draftFor(t, t.a, 'https://example.com/x');
    await draftFor(t, t.a, 'https://example.com/y');
    await request(t.app).patch(`${API}/prospects/${p.id}`).set(t.as(t.a)).send({ status: 'replied' }).expect(200);
    const res = await request(t.app)
      .get(`${API}/prospects/export?status=replied`)
      .set(t.as(t.a))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const ws = XLSX.read(res.body as Buffer, { type: 'buffer' }).Sheets.Prospects!;
    expect(XLSX.utils.sheet_to_json(ws)).toHaveLength(1);
  });

  it('deletes one and all', async () => {
    const t = await twoUsers();
    const p = await draftFor(t, t.a, 'https://example.com/x');
    await draftFor(t, t.a, 'https://example.com/y');
    await request(t.app).delete(`${API}/prospects/${p.id}`).set(t.as(t.a)).expect(204);
    await request(t.app).delete(`${API}/prospects`).set(t.as(t.a)).expect(400);
    const all = await request(t.app).delete(`${API}/prospects?confirm=all`).set(t.as(t.a)).expect(200);
    expect(all.body).toEqual({ deleted: 1 });
  });
});

describe('cross user isolation', () => {
  it('user B cannot read, edit, delete or export user A prospects', async () => {
    const t = await twoUsers();
    const p = await draftFor(t, t.a, 'https://example.com/a-secret');

    await request(t.app).get(`${API}/prospects/${p.id}`).set(t.as(t.b)).expect(404);
    await request(t.app).patch(`${API}/prospects/${p.id}`).set(t.as(t.b)).send({ subject: 'hijack' }).expect(404);
    await request(t.app).delete(`${API}/prospects/${p.id}`).set(t.as(t.b)).expect(404);

    const list = await request(t.app).get(`${API}/prospects`).set(t.as(t.b)).expect(200);
    expect(list.body.items).toHaveLength(0);

    const deleted = await request(t.app).delete(`${API}/prospects?confirm=all`).set(t.as(t.b)).expect(200);
    expect(deleted.body.deleted).toBe(0);

    const exported = await request(t.app)
      .get(`${API}/prospects/export`)
      .set(t.as(t.b))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const rows = XLSX.utils.sheet_to_json(XLSX.read(exported.body as Buffer, { type: 'buffer' }).Sheets.Prospects!);
    expect(rows).toHaveLength(0);

    // A's data is untouched.
    const own = await request(t.app).get(`${API}/prospects/${p.id}`).set(t.as(t.a)).expect(200);
    expect(own.body.subject).toBe(DRAFT.subject);
  });

  it('the same URL saved by two users creates two separate prospects', async () => {
    const t = await twoUsers();
    const a = await draftFor(t, t.a, 'https://example.com/shared');
    const b = await draftFor(t, t.b, 'https://example.com/shared');
    expect(a.id).not.toBe(b.id);
  });
});

describe('account deletion', () => {
  it('requires the password and deletes all of the user data', async () => {
    const t = await twoUsers();
    await draftFor(t, t.a, 'https://example.com/x');
    await draftFor(t, t.b, 'https://example.com/x');
    await request(t.app).delete(`${API}/account`).set(t.as(t.a)).send({ password: 'wrong password' }).expect(401);
    await request(t.app).delete(`${API}/account`).set(t.as(t.a)).send({ password: 'correct horse battery' }).expect(204);

    await request(t.app).get(`${API}/settings`).set(t.as(t.a)).expect(401);
    await request(t.app).post(`${API}/auth/login`).send({ email: 'a@example.com', password: 'correct horse battery' }).expect(401);
    const bList = await request(t.app).get(`${API}/prospects`).set(t.as(t.b)).expect(200);
    expect(bList.body.items).toHaveLength(1);
    const mongoose = (await import('mongoose')).default;
    const remaining = await mongoose.connection.db!.collection('prospects').countDocuments();
    expect(remaining).toBe(1);
  });
});
