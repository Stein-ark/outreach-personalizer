/**
 * Boot: validate the environment, load the base instructions, verify the AI model, then listen at once. MongoDB is
 * connected in the background with retries, so a database outage never stops the server from starting, and
 * features that do not need the database keep working meanwhile. SIGINT and SIGTERM shut down cleanly.
 */
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { loadEnv } from './env.js';
import { createLogger } from './lib/logger.js';
import { createRateLimits } from './lib/rateLimits.js';
import { createApp } from './app.js';
import { syncIndexes } from './db/models.js';
import { loadBaseInstructions } from './ai/baseInstructions.js';
import { OpenAiCompatibleProvider, ProviderUnreachableError, type AiProvider } from './ai/provider.js';
import { AiLimiter } from './ai/limiter.js';
import { AiGateway } from './ai/gateway.js';
import { TokenService } from './auth/tokens.js';
import { SessionService } from './auth/sessions.js';

/**
 * Verifies the configured model at boot. A definite answer (model missing, key rejected) stops the server. If the
 * provider cannot be reached after a few tries, the server starts anyway with a warning: accounts and saved prospects
 * keep working, and AI requests return AI_UNAVAILABLE until the provider is reachable again.
 */
async function verifyModel(provider: AiProvider, logger: Logger): Promise<boolean> {
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      await provider.checkModel();
      return true;
    } catch (err) {
      if (!(err instanceof ProviderUnreachableError)) throw err;
      if (attempt === attempts) {
        logger.warn({ provider: provider.name }, `AI provider unreachable at boot after ${attempts} tries. Starting anyway; AI requests will fail until it is reachable.`);
        return false;
      }
      logger.warn({ provider: provider.name, attempt }, 'AI provider unreachable, retrying model check');
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Connects to MongoDB, retrying with backoff (2 s doubling up to 30 s) until it succeeds, then builds indexes.
 * After the first connection the driver reconnects by itself.
 */
async function connectDatabase(uri: string, logger: Logger, isClosing: () => boolean): Promise<void> {
  for (let delay = 2000; !isClosing(); delay = Math.min(delay * 2, 30_000)) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
      await syncIndexes();
      logger.info('database connected');
      return;
    } catch (err) {
      logger.warn({ err: { name: (err as Error).name }, retryInMs: delay }, 'database unavailable, retrying');
      await mongoose.disconnect().catch(() => undefined);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

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
  const aiReachable = env.AI_SKIP_MODEL_CHECK ? null : await verifyModel(provider, logger);

  const limiter = new AiLimiter({
    rpm: env.AI_LIMIT_RPM,
    tpm: env.AI_LIMIT_TPM,
    rpd: env.AI_LIMIT_RPD,
    tpd: env.AI_LIMIT_TPD,
    maxWaitMs: env.AI_LIMIT_MAX_WAIT_MS,
  });
  const gateway = new AiGateway(provider, limiter, logger, { maxWaitMs: env.AI_LIMIT_MAX_WAIT_MS });
  if (aiReachable !== null) gateway.reachability = aiReachable ? 'up' : 'unreachable';

  // Fail fast instead of queueing queries for 10 seconds when the database is down. Routes map that to DB_UNAVAILABLE.
  mongoose.set('bufferCommands', false);
  mongoose.connection.on('disconnected', () => logger.warn('database disconnected, the driver will reconnect'));
  mongoose.connection.on('reconnected', () => logger.info('database reconnected'));

  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const sessions = new SessionService(tokens, env.REFRESH_TOKEN_TTL_DAYS);
  const app = createApp({ env, logger, tokens, sessions, gateway, base, limits: createRateLimits() });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, model: provider.model, instructions: base.version }, 'server listening');
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  let closing = false;
  void connectDatabase(env.MONGODB_URI, logger, () => closing);
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
