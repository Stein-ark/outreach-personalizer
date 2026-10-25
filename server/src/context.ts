/** Everything the routes need, built once at boot (or per test) and passed in explicitly. No module level state. */
import type { Logger } from 'pino';
import type { Env } from './env.js';
import type { AiGateway } from './ai/gateway.js';
import type { BaseInstructions } from './ai/baseInstructions.js';
import type { SessionService } from './auth/sessions.js';
import type { TokenService } from './auth/tokens.js';
import type { RateLimitSet } from './lib/rateLimits.js';

export interface AppContext {
  env: Env;
  logger: Logger;
  tokens: TokenService;
  sessions: SessionService;
  gateway: AiGateway;
  base: BaseInstructions;
  limits: RateLimitSet;
}
