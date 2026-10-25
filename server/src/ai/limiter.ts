/**
 * Shared in process limiter for AI calls, sized below the provider's per organisation limits.
 * It tracks requests and tokens in a sliding 60 second window and in a UTC day.
 * A call reserves its estimated tokens up front and settles to the real usage afterwards.
 *
 * Single instance only: the counters live in this process. Running several server instances
 * against one Groq organisation needs a shared store (for example Redis) instead.
 */

export interface LimiterConfig {
  rpm: number;
  tpm: number;
  rpd: number;
  tpd: number;
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class LimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('AI capacity exceeded');
  }
}

export interface Reservation {
  /** Replace the estimate with the tokens the call actually used. */
  settle(actualTokens: number): void;
}

interface Entry {
  t: number;
  tokens: number;
}

const MINUTE = 60_000;

export class AiLimiter {
  private window: Entry[] = [];
  private day = { key: '', requests: 0, tokens: 0 };
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: LimiterConfig) {
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Waits for capacity up to maxWaitMs, then reserves. Throws LimitExceededError when the wait would be longer. */
  async acquire(estimatedTokens: number): Promise<Reservation> {
    const deadline = this.now() + this.config.maxWaitMs;
    for (;;) {
      const result = this.tryReserve(estimatedTokens);
      if ('reservation' in result) return result.reservation;
      if (this.now() + result.waitMs > deadline) throw new LimitExceededError(Math.ceil(result.waitMs / 1000));
      await this.sleep(result.waitMs);
    }
  }

  /** Reserves synchronously if there is room now, otherwise reports how long until there is. */
  tryReserve(estimatedTokens: number): { reservation: Reservation } | { waitMs: number } {
    const now = this.now();
    // A single request larger than the whole minute budget could never fit, so it is capped to the budget.
    const est = Math.min(Math.max(1, Math.round(estimatedTokens)), this.config.tpm);
    this.rollDay(now);
    this.window = this.window.filter((e) => e.t > now - MINUTE);

    if (this.day.requests + 1 > this.config.rpd || this.day.tokens + est > this.config.tpd) {
      return { waitMs: msUntilNextUtcDay(now) };
    }
    if (this.window.length + 1 > this.config.rpm) {
      return { waitMs: this.window[0]!.t + MINUTE - now };
    }
    const used = this.window.reduce((sum, e) => sum + e.tokens, 0);
    if (used + est > this.config.tpm) {
      // Find the earliest moment enough old entries have aged out to make room.
      let freed = 0;
      for (const e of this.window) {
        freed += e.tokens;
        if (used - freed + est <= this.config.tpm) return { waitMs: e.t + MINUTE - now };
      }
    }

    const entry: Entry = { t: now, tokens: est };
    this.window.push(entry);
    this.day.requests += 1;
    this.day.tokens += est;
    const dayKey = this.day.key;
    return {
      reservation: {
        settle: (actual: number) => {
          const delta = Math.max(0, Math.round(actual)) - entry.tokens;
          entry.tokens += delta;
          if (this.day.key === dayKey) this.day.tokens += delta;
        },
      },
    };
  }

  private rollDay(now: number): void {
    const key = new Date(now).toISOString().slice(0, 10);
    if (key !== this.day.key) this.day = { key, requests: 0, tokens: 0 };
  }
}

function msUntilNextUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/** Rough token estimate (about 4 characters per token) plus the output allowance. Settled to real usage after the call. */
export function estimateTokens(system: string, user: string, maxOutputTokens: number): number {
  return Math.ceil((system.length + user.length) / 4) + 20 + maxOutputTokens;
}
