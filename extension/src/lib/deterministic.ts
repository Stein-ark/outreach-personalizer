/**
 * Deterministic extraction from a page snapshot: JSON-LD, title patterns and mailto links.
 * These run before any AI call, and the model is only asked to fill what is still null.
 * Nothing is guessed: a field stays null unless the page states it in a structured or unambiguous way.
 */
import { EMPTY_FIELDS, FIELD_KEYS, FIELD_LIMITS, ProspectFields, type PageSnapshot } from '@op/shared';

import { PERSON_NAME } from './names';

/** "Jane Doe | Partner at Northwind", "Jane Doe - CEO @ Acme - Site" and similar. */
const TITLE_PATTERN = /^(.{3,60}?)\s+[|\u2013\u2014-]\s+(.{2,80}?)\s+(?:at|@)\s+(.{2,80}?)(?:\s+[|\u2013\u2014-]\s+.*)?$/;
/** "Partner at Northwind Ventures" as a heading or og:description start. */
const ROLE_AT_COMPANY = /^(.{2,60}?)\s+(?:at|@)\s+([\p{Lu}0-9][^.,;|]{1,60})$/u;

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const looksLikeName = (s: string | null | undefined): s is string => Boolean(s && s.length <= 60 && PERSON_NAME.test(s.trim()));

export function hintsFromSnapshot(s: PageSnapshot): ProspectFields {
  const out: ProspectFields = { ...EMPTY_FIELDS };
  const visible = `${s.text}\n${s.headings.join('\n')}`.toLowerCase();

  const person = s.jsonLd.find((e) => e.type === 'Person' && looksLikeName(e.name));
  const org = s.jsonLd.find((e) => e.type === 'Organization' && e.name);
  if (person) {
    out.name = person.name;
    out.role = person.jobTitle;
    out.company = person.worksFor ?? null;
    out.bio = person.description ? person.description.slice(0, 600) : null;
  } else if (org && !s.jsonLd.some((e) => e.type === 'Person')) {
    out.company = org.name;
    out.bio = org.description ? org.description.slice(0, 600) : null;
  }

  const title = TITLE_PATTERN.exec(s.og.title ?? s.title);
  if (title && looksLikeName(title[1])) {
    out.name ??= title[1]!.trim();
    out.role ??= title[2]!.trim();
    out.company ??= title[3]!.trim();
  }

  if (out.name && (!out.role || !out.company)) {
    const roleLine = s.headings.map((h) => ROLE_AT_COMPANY.exec(h)).find(Boolean);
    if (roleLine) {
      out.role ??= roleLine[1]!.trim();
      out.company ??= roleLine[2]!.trim();
    }
  }

  // Email only when it literally appears on the page: a single mailto link, a JSON-LD email that is also visible,
  // or the only address written in the visible text. With several candidates the choice is left to the user.
  const uniqueMailtos = [...new Set(s.mailtos)];
  const textEmails = [...new Set((s.text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase()))];
  if (uniqueMailtos.length === 1) out.email = uniqueMailtos[0]!;
  else if (person?.email && (visible.includes(person.email.toLowerCase()) || s.mailtos.includes(person.email.toLowerCase()))) {
    out.email = person.email.toLowerCase();
  } else if (uniqueMailtos.length === 0 && textEmails.length === 1) {
    out.email = textEmails[0]!;
  }

  return finalize(out);
}

/** Every address on the page (mailto links first, then visible text), for the user to choose from. At most 10. */
export function emailChoicesFrom(s: PageSnapshot): string[] {
  const all = [...s.mailtos, ...(s.text.match(EMAIL_IN_TEXT) ?? [])].map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e));
  return [...new Set(all)].slice(0, 10);
}

/** True when the address's local part contains the person's first or last name (maya@, m.ortiz@, ortiz.m@). */
export function emailMatchesName(email: string, name: string | null): boolean {
  if (!name) return false;
  const local = email.split('@')[0]!.toLowerCase().replace(/[^a-z]/g, '');
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z ]/g, '')
    .split(' ')
    .some((part) => part.length >= 3 && local.includes(part));
}

/** Clips each field to its limit and drops any single value the strict schema rejects (for example a bad email). */
function finalize(fields: ProspectFields): ProspectFields {
  const out: ProspectFields = { ...EMPTY_FIELDS };
  for (const key of FIELD_KEYS) {
    const value = fields[key]?.trim().slice(0, FIELD_LIMITS[key]) ?? null;
    const parsed = ProspectFields.shape[key].safeParse(value);
    out[key] = parsed.success ? parsed.data : null;
  }
  return out;
}
