/**
 * The gateway is what routes call. It applies the shared limiter, retries once on a 429 (honouring retry-after,
 * with jitter) or on a transient failure, logs token counts (never content) and maps failures to AppErrors.
 */
import type { Logger } from 'pino';
import { AppError } from '../lib/errors.js';
import { AiLimiter, LimitExceededError, estimateTokens } from './limiter.js';
import { ProviderError, type AiProvider, type JsonCompletionRequest, type JsonCompletionResult } from './provider.js';

export interface GatewayOptions {
  maxWaitMs: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class AiGateway {
  /** Last known reachability of the provider, for /health. Updated by every call and by the boot check. */
  reachability: 'up' | 'unreachable' | 'unchecked' = 'unchecked';
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly provider: AiProvider,
    private readonly limiter: AiLimiter,
    private readonly logger: Logger,
    private readonly options: GatewayOptions,
  ) {
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get model(): string {
    return this.provider.model;
  }

  async completeJson(purpose: 'draft', req: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const estimate = estimateTokens(req.system, req.user, req.maxOutputTokens);
    let retried = false;
    for (;;) {
      let reservation;
      try {
        reservation = await this.limiter.acquire(estimate);
      } catch (err) {
        if (err instanceof LimitExceededError) throw busy(err.retryAfterSeconds);
        throw err;
      }
      const started = Date.now();
      try {
        const result = await this.provider.completeJson(req);
        reservation.settle(result.usage.total);
        this.reachability = 'up';
        this.logger.info(
          { ai: { purpose, model: this.provider.model, ms: Date.now() - started, ...result.usage } },
          'ai call',
        );
        return result;
      } catch (err) {
        // A failed call may still have consumed provider capacity, so the estimate is kept.
        if (!(err instanceof ProviderError)) throw err;
        this.logger.warn({ ai: { purpose, model: this.provider.model, kind: err.kind } }, 'ai call failed');
        if (err.kind === 'transient') this.reachability = 'unreachable';
        if (err.kind === 'invalid_output') throw err;
        if (err.kind === 'fatal') throw new AppError(502, 'AI_FAILED', 'The AI service could not complete this request.');
        const waitMs =
          err.kind === 'rate_limited' ? (err.retryAfterSeconds ?? 2) * 1000 + this.jitter() : 500 + this.jitter();
        if (retried || waitMs > this.options.maxWaitMs) {
          if (err.kind === 'rate_limited') throw busy(err.retryAfterSeconds ?? Math.ceil(waitMs / 1000));
          throw new AppError(503, 'AI_UNAVAILABLE', 'The AI service is not responding. Try again shortly.');
        }
        retried = true;
        await this.sleep(waitMs);
      }
    }
  }

  private jitter(): number {
    return Math.floor(this.random() * 1000);
  }
}

const busy = (seconds: number) =>
  new AppError(429, 'AI_RATE_LIMITED', `The AI service is busy. Try again in ${seconds} seconds.`, seconds);
