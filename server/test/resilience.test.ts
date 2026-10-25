/**
 * Fault isolation: one dependency failing must not take down features that do not need it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { EMPTY_FIELDS, type AuthResponse } from '@op/shared';
import { Prospect } from '../src/db/models.js';
import { buildTestApp, useMemoryMongo } from './helpers.js';

const mongoUri = useMemoryMongo();
const API = '/api/v1';
const SENDER = {
  sender: { name: 'Ada Founder', role: 'CEO', organisation: 'Gridline', offer: 'Raising a seed round.', link: null },
  defaultDials: { tone: 'warm', length: 'short', goal: 'book_call' },
  footer: null,
};
const FIELDS = { ...EMPTY_FIELDS, name: 'Jane Investor', company: 'Northwind', detail: 'Led the VoltCo seed round' };
const DRAFT = { subject: 'Your VoltCo round', body: 'Hi Jane,\n\nSaw you led VoltCo.\n\nAda', detailUsed: 'Led the VoltCo seed round' };
const EXTRACT_BODY = {
  mode: 'paste',
  url: null,
  title: null,
  text: 'Jane Investor is a partner at Northwind. She led the VoltCo seed round last year.',
  hints: EMPTY_FIELDS,
  mailtos: [],
};

/** Simulates Atlas becoming unreachable: queries fail at once instead of queueing. */
async function cutDatabase() {
  mongoose.set('bufferCommands', false);
  await mongoose.disconnect();
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri());
  mongoose.set('bufferCommands', true);
});

async function signedIn() {
  const t = buildTestApp({ ALLOW_SIGNUP: 'true' });
  const res = await request(t.app).post(`${API}/auth/register`).send({ email: 'a@example.com', password: 'correct horse battery' }).expect(201);
  const auth = res.body as AuthResponse;
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  await request(t.app).put(`${API}/settings`).set(h).send(SENDER).expect(200);
  return { ...t, h };
}

describe('health reports each dependency separately', () => {
  it('shows db up and ai unchecked normally, and db down when the database is cut', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get(`${API}/health`).expect(200)).body).toMatchObject({ ok: true, db: 'up', ai: 'unchecked' });
    await cutDatabase();
    expect((await request(app).get(`${API}/health`).expect(200)).body).toMatchObject({ ok: true, db: 'down' });
  });
});

describe('database unavailable', () => {
  it('still extracts a page for a signed in user (no database needed)', async () => {
    const t = await signedIn();
    t.provider.reply({ name: 'Jane Investor', role: 'Partner', company: 'Northwind', bio: null, detail: 'Led the VoltCo seed round', email: null });
    await cutDatabase();
    const res = await request(t.app).post(`${API}/extract`).set(t.h).send(EXTRACT_BODY).expect(200);
    expect(res.body.fields.name).toBe('Jane Investor');
  });

  it('fails database routes fast with a clear DB_UNAVAILABLE instead of hanging or a generic error', async () => {
    const t = await signedIn();
    await cutDatabase();
    const started = Date.now();
    const res = await request(t.app).get(`${API}/prospects`).set(t.h).expect(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
    expect(res.body.error.message).toContain('Reading pages still works');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('still lets the AI answer even when the daily cap cannot be checked', async () => {
    const t = await signedIn();
    t.provider.reply({ name: null, role: null, company: null, bio: null, detail: null, email: null });
    await cutDatabase();
    await request(t.app).post(`${API}/extract`).set(t.h).send(EXTRACT_BODY).expect(200);
    expect(t.provider.calls).toHaveLength(1);
  });

  it('a database outage never signs anyone in: an invalid token is still refused', async () => {
    const t = await signedIn();
    await cutDatabase();
    await request(t.app).post(`${API}/extract`).set({ Authorization: 'Bearer not-a-token' }).send(EXTRACT_BODY).expect(401);
  });
});

describe('saving fails after a successful draft', () => {
  it('returns the draft with prospect null so the user can still copy it', async () => {
    const t = await signedIn();
    t.provider.reply(DRAFT);
    const outage = Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' });
    vi.spyOn(Prospect, 'create').mockRejectedValueOnce(outage);
    const res = await request(t.app)
      .post(`${API}/draft`)
      .set(t.h)
      .send({ fields: FIELDS, source: { mode: 'paste', url: null, title: null }, dials: SENDER.defaultDials })
      .expect(200);
    expect(res.body.prospect).toBeNull();
    expect(res.body.draft.subject).toBe(DRAFT.subject);
  });

  it('still reports real bugs (non outage errors) as errors', async () => {
    const t = await signedIn();
    t.provider.reply(DRAFT);
    vi.spyOn(Prospect, 'create').mockRejectedValueOnce(new Error('some programming error'));
    await request(t.app)
      .post(`${API}/draft`)
      .set(t.h)
      .send({ fields: FIELDS, source: { mode: 'paste', url: null, title: null }, dials: SENDER.defaultDials })
      .expect(500);
  });
});

describe('AI unavailable', () => {
  it('leaves sign in, settings and the saved list working', async () => {
    const t = await signedIn();
    // No scripted reply: any AI call would fail. None of these routes make one.
    await request(t.app).get(`${API}/settings`).set(t.h).expect(200);
    await request(t.app).get(`${API}/prospects`).set(t.h).expect(200);
    await request(t.app).get(`${API}/prospects/export`).set(t.h).expect(200);
    await request(t.app).post(`${API}/auth/login`).send({ email: 'a@example.com', password: 'correct horse battery' }).expect(200);
    expect(t.provider.calls).toHaveLength(0);
  });
});
