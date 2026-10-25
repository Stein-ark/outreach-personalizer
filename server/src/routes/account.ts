/** Settings (the sender's name and link) and account deletion. */
import { Router } from 'express';
import { Types } from 'mongoose';
import { DeleteAccountRequest, EMPTY_SENDER, Settings, type Settings as SettingsDto } from '@op/shared';
import { Prospect, RefreshSession, UsageCounter, User, type UserDoc } from '../db/models.js';
import { invalidCredentials, unauthenticated } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { userIdOf } from '../auth/middleware.js';
import { verifyPassword } from '../auth/passwords.js';

export function settingsOf(user: Pick<UserDoc, 'settings'>): SettingsDto {
  const s = user.settings?.sender;
  return {
    sender: {
      name: s?.name ?? EMPTY_SENDER.name,
      link: s?.link ?? EMPTY_SENDER.link,
    },
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

  /** Deletes the account and every piece of data tied to it. Requires the password as confirmation. */
  r.delete('/account', async (req, res) => {
    const { password } = parse(DeleteAccountRequest, req.body);
    const userId = userIdOf(req);
    const user = await loadUser(userId);
    if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
    const owner = new Types.ObjectId(userId);
    await Promise.all([
      Prospect.deleteMany({ userId: owner }),
      RefreshSession.deleteMany({ userId: owner }),
      UsageCounter.deleteMany({ userId: owner }),
    ]);
    await User.deleteOne({ _id: owner });
    res.status(204).end();
  });

  return r;
}
