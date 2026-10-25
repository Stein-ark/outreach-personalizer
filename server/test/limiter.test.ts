import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { AiLimiter, LimitExceededError, estimateTokens } from '../src/ai/limiter.js';
import { AiGateway } from '../src/ai/gateway.js';
import { ProviderError } from '../src/ai/provider.js';
import { AppError } from '../src/lib/errors.js';
import { FakeProvider } from './helpers.js';

function clock(start = Date.UTC(2026, 9, 25, 12, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const cfg = { rpm: 2, tpm: 1000, rpd: 100, tpd: 100_000, maxWaitMs: 0 };

describe('AiLimiter', () => {
  it('limits requests per minute and frees capacity after 60 seconds', () => {
    const c = clock();
    const l = new AiLimiter({ ...cfg, now: c.now });
    expect('reservation' in l.tryReserve(10)).toBe(true);
    c.advance(10_000);
    expect('reservation' in l.tryReserve(10)).toBe(true);
    const blocked = l.tryReserve(10);
    expect(blocked).toEqual({ waitMs: 50_000 });
    c.advance(50_000);
    expect('reservation' in l.tryReserve(10)).toBe(true);
  });

  it('limits tokens per minute and waits for the oldest entry that frees enough', () => {
    const c = clock();
    const l = new AiLimiter({ ...cfg, rpm: 100, now: c.now });
    l.tryReserve(600);
    c.advance(5_000);
    l.tryReserve(300);
    expect(l.tryReserve(300)).toEqual({ waitMs: 55_000 });
  });

  it('settles a reservation to the real usage', () => {
    const c = clock();
    const l = new AiLimiter({ ...cfg, rpm: 100, now: c.now });
    const r = l.tryReserve(900);
    expect('waitMs' in l.tryReserve(500)).toBe(true);
    if ('reservation' in r) r.reservation.settle(100);
    expect('reservation' in l.tryReserve(500)).toBe(true);
  });

  it('enforces the daily request budget until the next UTC day', () => {
    const c = clock(Date.UTC(2026, 9, 25, 23, 59, 0));
    const l = new AiLimiter({ ...cfg, rpm: 100, rpd: 1, now: c.now });
    l.tryReserve(1);
    expect(l.tryReserve(1)).toEqual({ waitMs: 60_000 });
    c.advance(60_000);
    expect('reservation' in l.tryReserve(1)).toBe(true);
  });

  it('throws with retry seconds when the wait exceeds maxWaitMs', async () => {
    const c = clock();
    const l = new AiLimiter({ ...cfg, rpm: 1, maxWaitMs: 1000, now: c.now });
    await l.acquire(1);
    await expect(l.acquire(1)).rejects.toEqual(new LimitExceededError(60));
  });

  it('waits when the wait fits inside maxWaitMs', async () => {
    const c = clock();
    const slept: number[] = [];
    const l = new AiLimiter({ ...cfg, rpm: 1, maxWaitMs: 60_000, now: c.now, sleep: async (ms) => void slept.push(c.advance(ms)) });
    await l.acquire(1);
    await l.acquire(1);
    expect(slept).toHaveLength(1);
  });

  it('estimates tokens from characters plus the output allowance', () => {
    expect(estimateTokens('a'.repeat(400), 'b'.repeat(400), 500)).toBe(200 + 20 + 500);
  });
});

describe('AiGateway retry policy', () => {
  const ok = { content: '{}', usage: { prompt: 1, completion: 1, total: 2 } };
  const req = { system: 's', user: 'u', schemaName: 'x', schema: {}, maxOutputTokens: 10 };
  const roomy = () => new AiLimiter({ rpm: 100, tpm: 100_000, rpd: 1000, tpd: 1_000_000, maxWaitMs: 0 });

  it('honours retry-after plus jitter on a 429 and retries once', async () => {
    const provider = new FakeProvider().reply(() => {
      throw new ProviderError('rate_limited', '429', 3);
    }, () => ok);
    const sleeps: number[] = [];
    const g = new AiGateway(provider, roomy(), pino({ level: 'silent' }), { maxWaitMs: 10_000, random: () => 0.5, sleep: async (ms) => void sleeps.push(ms) });
    await expect(g.completeJson('draft', req)).resolves.toEqual(ok);
    expect(sleeps).toEqual([3500]);
  });

  it('returns a friendly error with seconds after a second 429', async () => {
    const limited = () => {
      throw new ProviderError('rate_limited', '429', 2);
    };
    const provider = new FakeProvider().reply(limited, limited);
    const g = new AiGateway(provider, roomy(), pino({ level: 'silent' }), { maxWaitMs: 10_000, random: () => 0, sleep: async () => {} });
    const err = await g.completeJson('draft', req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('AI_RATE_LIMITED');
    expect((err as AppError).retryAfterSeconds).toBe(2);
  });

  it('does not wait when retry-after is longer than allowed', async () => {
    const provider = new FakeProvider().reply(() => {
      throw new ProviderError('rate_limited', '429', 40);
    });
    const g = new AiGateway(provider, roomy(), pino({ level: 'silent' }), { maxWaitMs: 5000, sleep: async () => {} });
    const err = (await g.completeJson('draft', req).catch((e: unknown) => e)) as AppError;
    expect(err.retryAfterSeconds).toBe(40);
    expect(provider.calls).toHaveLength(1);
  });

  it('maps a fatal provider error to AI_FAILED without retrying', async () => {
    const provider = new FakeProvider().reply(() => {
      throw new ProviderError('fatal', 'bad');
    });
    const g = new AiGateway(provider, roomy(), pino({ level: 'silent' }), { maxWaitMs: 5000, sleep: async () => {} });
    expect(((await g.completeJson('extract', req).catch((e: unknown) => e)) as AppError).code).toBe('AI_FAILED');
    expect(provider.calls).toHaveLength(1);
  });

  it('turns limiter exhaustion into AI_RATE_LIMITED', async () => {
    const provider = new FakeProvider().reply(() => ok, () => ok);
    const tight = new AiLimiter({ rpm: 1, tpm: 100_000, rpd: 1000, tpd: 1_000_000, maxWaitMs: 0 });
    const g = new AiGateway(provider, tight, pino({ level: 'silent' }), { maxWaitMs: 0 });
    await g.completeJson('draft', req);
    expect(((await g.completeJson('draft', req).catch((e: unknown) => e)) as AppError).code).toBe('AI_RATE_LIMITED');
  });
});
