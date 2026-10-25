/** Test helpers: an in-memory MongoDB, a scripted fake AI provider and an app context built from them. */
import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import { loadEnv, type Env } from '../src/env.js';
import { createApp } from '../src/app.js';
import { syncIndexes } from '../src/db/models.js';
import { createRateLimits } from '../src/lib/rateLimits.js';
import { AiGateway } from '../src/ai/gateway.js';
import { AiLimiter } from '../src/ai/limiter.js';
import { loadBaseInstructions } from '../src/ai/baseInstructions.js';
import { TokenService } from '../src/auth/tokens.js';
import { SessionService } from '../src/auth/sessions.js';
import type { AiProvider, JsonCompletionRequest, JsonCompletionResult } from '../src/ai/provider.js';

export const EXTENSION_ORIGIN = `chrome-extension://${'a'.repeat(32)}`;

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:1/unused',
    CORS_ORIGINS: EXTENSION_ORIGIN,
    JWT_SECRET: 'x'.repeat(40),
    AI_API_KEY: 'test-key',
    AI_MODEL: 'test-model',
    AI_SKIP_MODEL_CHECK: 'true',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

type Reply = (req: JsonCompletionRequest) => JsonCompletionResult | Promise<JsonCompletionResult>;

/** A provider that answers from a queue of scripted replies and records every request it saw. */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'test-model';
  readonly calls: JsonCompletionRequest[] = [];
  private queue: Reply[] = [];

  reply(...replies: (Reply | object)[]): this {
    for (const r of replies) {
      this.queue.push(typeof r === 'function' ? (r as Reply) : () => ({ content: JSON.stringify(r), usage: { prompt: 10, completion: 10, total: 20 } }));
    }
    return this;
  }

  async checkModel(): Promise<void> {}

  async completeJson(req: JsonCompletionRequest): Promise<JsonCompletionResult> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error('FakeProvider: no scripted reply left');
    return next(req);
  }
}

export function buildTestApp(envOverrides: Record<string, string> = {}) {
  const env = testEnv(envOverrides);
  const logger = pino({ level: 'silent' });
  const provider = new FakeProvider();
  const limiter = new AiLimiter({ rpm: 1000, tpm: 1_000_000, rpd: 100_000, tpd: 10_000_000, maxWaitMs: 0 });
  const gateway = new AiGateway(provider, limiter, logger, { maxWaitMs: 0, sleep: async () => {} });
  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const sessions = new SessionService(tokens, env.REFRESH_TOKEN_TTL_DAYS);
  const app = createApp({ env, logger, tokens, sessions, gateway, base: loadBaseInstructions(), limits: createRateLimits() });
  return { app, provider, env, tokens, sessions, gateway };
}

/** Starts one in-memory MongoDB for the test file and wipes all collections between tests. Returns the URI getter. */
export function useMemoryMongo(): () => string {
  let mongo: MongoMemoryServer;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await syncIndexes();
  });
  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  return () => mongo.getUri();
}
