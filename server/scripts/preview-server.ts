/**
 * UI preview server: the real API on an in-memory MongoDB with a canned stand-in for the AI, so the extension
 * can be clicked through without a Groq key or Atlas. Data disappears when it stops. Never use it in production.
 *
 * Run from server/: CORS_ORIGINS=chrome-extension://<id> npm run preview
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { createApp } from '../src/app.js';
import { syncIndexes } from '../src/db/models.js';
import { loadEnv } from '../src/env.js';
import { createRateLimits } from '../src/lib/rateLimits.js';
import { AiGateway } from '../src/ai/gateway.js';
import { AiLimiter } from '../src/ai/limiter.js';
import { loadBaseInstructions } from '../src/ai/baseInstructions.js';
import { TokenService } from '../src/auth/tokens.js';
import { SessionService } from '../src/auth/sessions.js';
import type { AiProvider, JsonCompletionRequest } from '../src/ai/provider.js';

/** Pulls the content of one nonce delimited block out of the assembled prompt. */
function blockOf(user: string, kind: string): string {
  const m = new RegExp(`<<<${kind} id=\\w+>>>\\n([\\s\\S]*?)\\n<<<END ${kind} id=\\w+>>>`).exec(user);
  return m?.[1] ?? '';
}

const line = (block: string, key: string) => {
  const v = new RegExp(`^${key}: (.*)$`, 'm').exec(block)?.[1];
  return v && v !== '(unknown)' ? v : null;
};

/** Canned answers shaped like the real model's. Clearly not AI quality, only for exercising the UI. */
const cannedProvider: AiProvider = {
  name: 'preview',
  model: 'preview-canned',
  async checkModel() {},
  async completeJson(req: JsonCompletionRequest) {
    await new Promise((r) => setTimeout(r, 900));
    const usage = { prompt: 0, completion: 0, total: 0 };
    if (req.schemaName === 'prospect_fields') {
      const sentences = blockOf(req.user, 'PAGE TEXT').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
      return { content: JSON.stringify({ name: null, role: null, company: null, bio: sentences[0] ?? null, detail: sentences[1] ?? null, email: null }), usage };
    }
    const prospect = blockOf(req.user, 'PROSPECT');
    const sender = blockOf(req.user, 'SENDER');
    const first = line(prospect, 'name')?.split(' ')[0];
    const detail = line(prospect, 'notable detail') ?? line(prospect, 'bio') ?? 'your recent work';
    const body = `${first ? `Hi ${first},` : 'Hi there,'}\n\n${detail.replace(/\.$/, '')} is why I am writing. (Preview server: this is canned text, not a real draft.)\n\n${line(sender, 'raising for or offering') ?? ''}\n\nWould you be open to a 20 minute call in the next two weeks?\n\n${line(sender, 'name') ?? ''}`;
    return { content: JSON.stringify({ subject: `${line(prospect, 'company') ?? 'Your work'} and ${line(sender, 'organisation') ?? 'us'}`, body, detailUsed: detail }), usage };
  },
};

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
await syncIndexes();

const env = loadEnv({
  ...process.env,
  NODE_ENV: 'development',
  MONGODB_URI: mongo.getUri(),
  JWT_SECRET: process.env.JWT_SECRET ?? 'preview-only-secret-preview-only-secret',
  AI_API_KEY: 'unused',
  AI_MODEL: cannedProvider.model,
  AI_SKIP_MODEL_CHECK: 'true',
  ALLOW_SIGNUP: 'true',
});
const logger = pino({ level: 'info' });
const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
const gateway = new AiGateway(cannedProvider, new AiLimiter({ rpm: 100, tpm: 1_000_000, rpd: 10_000, tpd: 10_000_000, maxWaitMs: 0 }), logger, { maxWaitMs: 0 });
const app = createApp({
  env,
  logger,
  tokens,
  sessions: new SessionService(tokens, env.REFRESH_TOKEN_TTL_DAYS),
  gateway,
  base: loadBaseInstructions(),
  limits: createRateLimits(),
});
app.listen(env.PORT, () => logger.warn({ port: env.PORT }, 'PREVIEW server: in-memory database and canned AI, not for real use'));
