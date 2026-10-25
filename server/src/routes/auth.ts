/** Register, login, refresh and logout. These are the only data routes that do not need an access token. */
import { Router } from 'express';
import { AuthResponse, Credentials, LoginRequest, RefreshRequest } from '@op/shared';
import { User } from '../db/models.js';
import { AppError, invalidCredentials } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import type { IssuedTokens } from '../auth/sessions.js';
import type { AppContext } from '../context.js';

const authBody = (user: { _id: unknown; email: string }, t: IssuedTokens): AuthResponse => ({
  ...t,
  user: { id: String(user._id), email: user.email },
});

/** ALLOW_SIGNUP=true or false forces the choice. Unset, signup is open only until the first account exists. */
async function signupAllowed(ctx: AppContext): Promise<boolean> {
  if (ctx.env.ALLOW_SIGNUP !== undefined) return ctx.env.ALLOW_SIGNUP;
  return (await User.estimatedDocumentCount()) === 0;
}

export function authRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post('/register', ctx.limits.register, async (req, res) => {
    const { email, password } = parse(Credentials, req.body);
    if (!(await signupAllowed(ctx))) throw new AppError(403, 'SIGNUP_DISABLED', 'Sign up is closed on this server.');
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await User.create({ email, passwordHash });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      throw err;
    }
    res.status(201).json(authBody(user, await ctx.sessions.start(String(user._id))));
  });

  r.post('/login', ...ctx.limits.login, async (req, res) => {
    const { email, password } = parse(LoginRequest, req.body);
    const user = await User.findOne({ email }).lean();
    // Same message, status and (thanks to the dummy hash) similar timing whether the email exists or not.
    const ok = await verifyPassword(user?.passwordHash ?? null, password);
    if (!user || !ok) throw invalidCredentials();
    res.json(authBody(user, await ctx.sessions.start(String(user._id))));
  });

  r.post('/refresh', ctx.limits.refresh, async (req, res) => {
    const { refreshToken } = parse(RefreshRequest, req.body);
    const result = await ctx.sessions.refresh(refreshToken);
    if (!result.ok) {
      if (result.reason === 'reused') ctx.logger.warn({ event: 'refresh_token_reuse' }, 'refresh token reuse detected, family revoked');
      throw new AppError(401, 'SESSION_EXPIRED', 'Your session expired. Please sign in again.');
    }
    const user = await User.findById(result.userId, { email: 1 }).lean();
    if (!user) throw new AppError(401, 'SESSION_EXPIRED', 'Your session expired. Please sign in again.');
    res.json(authBody(user, result.tokens));
  });

  r.post('/logout', ctx.limits.refresh, async (req, res) => {
    const { refreshToken } = parse(RefreshRequest, req.body);
    await ctx.sessions.revokeByToken(refreshToken);
    res.status(204).end();
  });

  return r;
}
