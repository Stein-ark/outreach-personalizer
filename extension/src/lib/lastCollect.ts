/**
 * The result of the last on demand collection (icon click, menu item or shortcut), handed from the service worker to
 * the panel through session storage, so the panel can say what happened even if it opened after the work was done.
 */
import { z } from 'zod';

export const LAST_COLLECT_KEY = 'lastCollect';

export const LastCollect = z.object({
  at: z.number(),
  title: z.string().nullable(),
  outcome: z.enum(['saved', 'none', 'restricted', 'blocked', 'failed', 'signed_out']),
  found: z.number().int(),
  added: z.number().int(),
});
export type LastCollect = z.infer<typeof LastCollect>;
