/**
 * The only message the service worker accepts: people found by the automatic collector on one page.
 * It is validated twice: the sender must be this extension's own content script in a tab's top frame, and the
 * payload must match this schema exactly.
 */
import { z } from 'zod';
import { COLLECT_MAX_PEOPLE, CollectedPerson } from '@op/shared';

export const CollectMessage = z.strictObject({
  type: z.literal('op:collected'),
  url: z.string().max(2048),
  title: z.string().max(300),
  people: z.array(CollectedPerson).min(1).max(COLLECT_MAX_PEOPLE),
});
export type CollectMessage = z.infer<typeof CollectMessage>;
