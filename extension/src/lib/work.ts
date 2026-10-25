/**
 * The in-progress prospect, kept in chrome.storage.session so closing the panel or a service worker restart
 * loses nothing. Field values are stored loosely (any string) because they may be mid-edit, and are validated
 * with the strict shared schema only when sent to the server.
 */
import { z } from 'zod';
import { Dials, DraftOutput, FIELD_KEYS, FieldOrigin, SourceMode } from '@op/shared';
import { ReadResult } from './reader';

export const WORK_KEY = 'work';
export const PENDING_READ_KEY = 'pendingRead';

const LooseFields = z.object(Object.fromEntries(FIELD_KEYS.map((k) => [k, z.string().nullable()])) as Record<(typeof FIELD_KEYS)[number], z.ZodNullable<z.ZodString>>);
export type LooseFields = z.infer<typeof LooseFields>;

export const WorkPhase = z.enum(['extracting', 'interrupted', 'review', 'drafting', 'drafted']);
export type WorkPhase = z.infer<typeof WorkPhase>;

export const WorkItem = z.object({
  id: z.string(),
  tabId: z.number().int().nullable(),
  source: z.object({ mode: SourceMode, url: z.string().nullable(), title: z.string().nullable() }),
  phase: WorkPhase,
  fields: LooseFields,
  origins: z.record(z.string(), FieldOrigin),
  textTruncated: z.boolean(),
  confirmed: z.boolean(),
  dials: Dials,
  draft: DraftOutput.nullable(),
  prospectId: z.string().nullable(),
  /** Every address that appears on the page, offered in the Email field when there is more than one. */
  emailChoices: z.array(z.string()).default([]),
  /** When the server deletes the saved prospect (null until saved). */
  expiresAt: z.string().nullable().default(null),
  /** True when the draft or fields were edited after the last save. */
  dirty: z.boolean(),
  /** Set when the user switched to another tab or navigated away from the page this work came from. */
  staleReason: z.enum(['tab', 'navigated']).nullable(),
});
export type WorkItem = z.infer<typeof WorkItem>;

/** Written by the service worker after a user gesture, consumed (and removed) by the panel. */
export const PendingRead = z.object({ at: z.number(), result: ReadResult });
export type PendingRead = z.infer<typeof PendingRead>;
