/**
 * Typed access to chrome.storage. Every read is validated with a zod schema, so a corrupted or unexpected value
 * is treated as missing instead of crashing the panel.
 *
 * session: memory only, cleared when the browser closes, readable only by extension pages and the service worker.
 * local: persisted, used only for the refresh token so a browser restart does not sign the user out.
 */
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';

export type Area = 'session' | 'local';

const areaOf = (area: Area) => (area === 'session' ? browser.storage.session : browser.storage.local);

export async function getStored<S extends z.ZodType>(area: Area, key: string, schema: S): Promise<z.output<S> | null> {
  const raw = (await areaOf(area).get(key))[key];
  if (raw === undefined) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const setStored = (area: Area, key: string, value: unknown) => areaOf(area).set({ [key]: value });
export const removeStored = (area: Area, key: string | string[]) => areaOf(area).remove(key);

/** React binding: the current value plus a setter, kept in sync across panel instances via storage.onChanged. */
export function useStored<S extends z.ZodType>(area: Area, key: string, schema: S) {
  const [value, setValue] = useState<z.output<S> | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getStored(area, key, schema).then((v) => {
      if (alive) {
        setValue(v);
        setLoaded(true);
      }
    });
    const onChange = (changes: Record<string, { newValue?: unknown }>, changedArea: string) => {
      if (changedArea !== area || !(key in changes)) return;
      const next = changes[key]!.newValue;
      const parsed = next === undefined ? null : schema.safeParse(next);
      setValue(parsed && parsed.success ? parsed.data : null);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChange);
    };
  }, [area, key, schema]);

  const update = useCallback(
    async (next: z.output<S> | null) => {
      setValue(next);
      if (next === null) await removeStored(area, key);
      else await setStored(area, key, next);
    },
    [area, key],
  );

  return { value, loaded, update };
}
