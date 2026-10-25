/**
 * Saved emails are deleted by the server a few hours after they are first saved (PROSPECT_TTL_HOURS).
 * These helpers show how long is left so users export in time.
 */
import { useEffect, useState } from 'react';

/** Below this, the UI warns and nudges the user to export. */
export const EXPIRY_WARNING_MS = 30 * 60_000;

/** The current time, refreshed every 30 seconds, so countdowns stay current without re-rendering every second. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
