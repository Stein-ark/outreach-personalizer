/**
 * The only message the service worker accepts: addresses found by the automatic collector on one page.
 * It is validated twice: the sender must be this extension's own content script in a tab's top frame, and the
 * payload must match this schema exactly.
 */
import { z } from 'zod';
import { COLLECT_MAX_EMAILS, FIELD_LIMITS } from '@op/shared';

export const CollectMessage = z.strictObject({
  type: z.literal('op:collected'),
  url: z.string().max(FIELD_LIMITS.url),
  title: z.string().max(FIELD_LIMITS.title),
  emails: z.array(z.string().max(FIELD_LIMITS.email)).min(1).max(COLLECT_MAX_EMAILS),
});
export type CollectMessage = z.infer<typeof CollectMessage>;
