/**
 * Fault isolation: one dependency failing must not take down features that do not need it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import type { AuthResponse } from '@op/shared';
import { Prospect } from '../src/db/models.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, useMemoryMongo } from './helpers.js';

const mongoUri = useMemoryMongo();
const API = '/api/v1';
const SETTINGS = { sender: { name: 'Ada Okafor', link: null } };
const DRAFT_REQUEST = { message: 'I build booking websites for clinics and would like to offer a free review.', dials: { tone: 'warm', length: 'short' } };

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
  const h = { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` };
  await request(t.app).put(`${API}/settings`).set(h).send(SETTINGS).expect(200);
  await request(t.app).post(`${API}/prospects/collect`).set(h).send({ url: 'https://x.example', title: null, emails: ['a@x.example'] }).expect(201);
  return { ...t, h };
}

describe('database unavailable', () => {
  it('health reports db down separately while the process stays up', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get(`${API}/health`).expect(200)).body).toMatchObject({ ok: true, db: 'up', ai: 'unchecked' });
    await cutDatabase();
    expect((await request(app).get(`${API}/health`).expect(200)).body).toMatchObject({ ok: true, db: 'down' });
  });

  it('fails fast with a clear DB_UNAVAILABLE instead of hanging or a generic error', async () => {
    const t = await signedIn();
    await cutDatabase();
    for (const call of [
      request(t.app).get(`${API}/prospects`).set(t.h),
      request(t.app).post(`${API}/prospects/collect`).set(t.h).send({ url: 'https://x.example', title: null, emails: ['b@x.example'] }),
      request(t.app).post(`${API}/auth/login`).send({ email: 'a@example.com', password: 'correct horse battery' }),
    ]) {
      const started = Date.now();
      const res = await call.expect(503);
      expect(res.body.error.code).toBe('DB_UNAVAILABLE');
      expect(Date.now() - started).toBeLessThan(3000);
    }
  });

  it('maps a database error in the middle of a request to DB_UNAVAILABLE, and real bugs to a plain 500', async () => {
    const t = await signedIn();
    vi.spyOn(Prospect, 'find').mockImplementationOnce(() => {
      throw Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' });
    });
    expect((await request(t.app).get(`${API}/prospects`).set(t.h).expect(503)).body.error.code).toBe('DB_UNAVAILABLE');
    vi.spyOn(Prospect, 'find').mockImplementationOnce(() => {
      throw new Error('some programming error');
    });
    const res = await request(t.app).get(`${API}/prospects`).set(t.h).expect(500);
    expect(res.body.error.message).not.toContain('programming');
  });
});

describe('AI unavailable', () => {
  it('collecting, the saved list, sheets and export keep working', async () => {
    const t = await signedIn();
    t.provider.reply(() => {
      throw new ProviderError('transient', 'down');
    });
    await request(t.app).post(`${API}/prospects/sheets/1/draft`).set(t.h).send(DRAFT_REQUEST).expect(503);
    await request(t.app).post(`${API}/prospects/collect`).set(t.h).send({ url: 'https://x.example', title: null, emails: ['b@x.example'] }).expect(201);
    await request(t.app).get(`${API}/prospects`).set(t.h).expect(200);
    await request(t.app).get(`${API}/prospects/sheets`).set(t.h).expect(200);
    await request(t.app).get(`${API}/prospects/export`).set(t.h).expect(200);
    await request(t.app).get(`${API}/settings`).set(t.h).expect(200);
  });
});
