/**
 * Boot: validate the environment, load the base instructions, verify the AI model exists, connect to MongoDB,
 * build indexes, then listen. SIGINT and SIGTERM close the HTTP server and the database cleanly.
 */
import mongoose from 'mongoose';
import { loadEnv } from './env.js';
import { createLogger } from './lib/logger.js';
import { createRateLimits } from './lib/rateLimits.js';
import { createApp } from './app.js';
import { syncIndexes } from './db/models.js';
import { loadBaseInstructions } from './ai/baseInstructions.js';
import { OpenAiCompatibleProvider } from './ai/provider.js';
import { AiLimiter } from './ai/limiter.js';
import { AiGateway } from './ai/gateway.js';
import { TokenService } from './auth/tokens.js';
import { SessionService } from './auth/sessions.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const base = loadBaseInstructions();

  const provider = new OpenAiCompatibleProvider({
    name: env.AI_PROVIDER,
    baseURL: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
    reasoningEffort: env.AI_REASONING_EFFORT,
  });
  if (!env.AI_SKIP_MODEL_CHECK) await provider.checkModel();

  const limiter = new AiLimiter({
    rpm: env.AI_LIMIT_RPM,
    tpm: env.AI_LIMIT_TPM,
    rpd: env.AI_LIMIT_RPD,
    tpd: env.AI_LIMIT_TPD,
    maxWaitMs: env.AI_LIMIT_MAX_WAIT_MS,
  });
  const gateway = new AiGateway(provider, limiter, logger, { maxWaitMs: env.AI_LIMIT_MAX_WAIT_MS });

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  await syncIndexes();

  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const sessions = new SessionService(tokens, env.REFRESH_TOKEN_TTL_DAYS);
  const app = createApp({ env, logger, tokens, sessions, gateway, base, limits: createRateLimits() });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, model: provider.model, instructions: base.version }, 'server listening');
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      mongoose
        .disconnect()
        .then(() => {
          clearTimeout(force);
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: Error) => {
  // Boot errors are configuration problems, so the message is printed as is for the operator.
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
