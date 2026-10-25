/**
 * Saved prospects are deleted by the server a few hours after they are first saved (PROSPECT_TTL_HOURS).
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

export const formatClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Whole hours (or minutes) between saving and deletion, for copy like "kept for 3 hours". */
export function retentionLabel(createdAt: string, expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.parse(createdAt);
  const hours = Math.round(ms / 3_600_000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(ms / 60_000)} minutes`;
}
