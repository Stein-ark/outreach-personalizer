/** Account settings, voice samples and account deletion. */
import { Router } from 'express';
import { Types } from 'mongoose';
import {
  DEFAULT_DIALS,
  DeleteAccountRequest,
  EMPTY_SENDER,
  Settings,
  VOICE_SAMPLE_MAX_COUNT,
  VoiceSampleCreate,
  objectId,
  type Settings as SettingsDto,
  type VoiceSampleList,
} from '@op/shared';
import { Prospect, RefreshSession, UsageCounter, User, VoiceSample, type UserDoc } from '../db/models.js';
import { AppError, invalidCredentials, notFound, unauthenticated } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { userIdOf } from '../auth/middleware.js';
import { verifyPassword } from '../auth/passwords.js';

export function settingsOf(user: Pick<UserDoc, 'settings'>): SettingsDto {
  const s = user.settings;
  return {
    sender: {
      name: s?.sender?.name ?? EMPTY_SENDER.name,
      role: s?.sender?.role ?? EMPTY_SENDER.role,
      organisation: s?.sender?.organisation ?? EMPTY_SENDER.organisation,
      offer: s?.sender?.offer ?? EMPTY_SENDER.offer,
      link: s?.sender?.link ?? EMPTY_SENDER.link,
    },
    defaultDials: {
      tone: s?.defaultDials?.tone ?? DEFAULT_DIALS.tone,
      length: s?.defaultDials?.length ?? DEFAULT_DIALS.length,
      goal: s?.defaultDials?.goal ?? DEFAULT_DIALS.goal,
    },
    footer: s?.footer ?? null,
  };
}

export async function loadUser(userId: string): Promise<UserDoc> {
  const user = await User.findById(userId).lean<UserDoc>();
  if (!user) throw unauthenticated();
  return user;
}

export function accountRoutes(): Router {
  const r = Router();

  r.get('/settings', async (req, res) => {
    res.json(settingsOf(await loadUser(userIdOf(req))));
  });

  r.put('/settings', async (req, res) => {
    const settings = parse(Settings, req.body);
    const user = await User.findByIdAndUpdate(userIdOf(req), { $set: { settings } }, { returnDocument: 'after' }).lean<UserDoc>();
    if (!user) throw unauthenticated();
    res.json(settingsOf(user));
  });

  r.get('/voice-samples', async (req, res) => {
    const docs = await VoiceSample.find({ userId: new Types.ObjectId(userIdOf(req)) }).sort({ createdAt: 1 }).lean();
    const body: VoiceSampleList = { items: docs.map((d) => ({ id: String(d._id), text: d.text, createdAt: d.createdAt.toISOString() })) };
    res.json(body);
  });

  r.post('/voice-samples', async (req, res) => {
    const { text } = parse(VoiceSampleCreate, req.body);
    const userId = new Types.ObjectId(userIdOf(req));
    if ((await VoiceSample.countDocuments({ userId })) >= VOICE_SAMPLE_MAX_COUNT) {
      throw new AppError(409, 'VOICE_SAMPLE_LIMIT', `You can keep up to ${VOICE_SAMPLE_MAX_COUNT} voice samples. Remove one first.`);
    }
    const doc = await VoiceSample.create({ userId, text });
    res.status(201).json({ id: String(doc._id), text: doc.text, createdAt: doc.createdAt.toISOString() });
  });

  r.delete('/voice-samples/:id', async (req, res) => {
    const id = parse(objectId, req.params.id);
    const result = await VoiceSample.deleteOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userIdOf(req)) });
    if (result.deletedCount === 0) throw notFound('Voice sample');
    res.status(204).end();
  });

  /** Deletes the account and every piece of data tied to it. Requires the password as confirmation. */
  r.delete('/account', async (req, res) => {
    const { password } = parse(DeleteAccountRequest, req.body);
    const userId = userIdOf(req);
    const user = await loadUser(userId);
    if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
    const owner = new Types.ObjectId(userId);
    await Promise.all([
      Prospect.deleteMany({ userId: owner }),
      VoiceSample.deleteMany({ userId: owner }),
      RefreshSession.deleteMany({ userId: owner }),
      UsageCounter.deleteMany({ userId: owner }),
    ]);
    await User.deleteOne({ _id: owner });
    res.status(204).end();
  });

  return r;
}
