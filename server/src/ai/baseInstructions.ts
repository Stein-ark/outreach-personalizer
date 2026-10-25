/**
 * Loads the tracked base instructions file. The version string from its front matter is stored on every draft,
 * so any draft can be traced back to the exact instructions that produced it.
 */
import { readFileSync } from 'node:fs';

export interface BaseInstructions {
  version: string;
  text: string;
}

const DEFAULT_PATH = new URL('../../config/base-instructions.md', import.meta.url);

export function parseBaseInstructions(raw: string): BaseInstructions {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  const version = match?.[1] ? /^version:\s*(\S+)\s*$/m.exec(match[1])?.[1] : undefined;
  const text = match?.[2]?.trim();
  if (!version || !text) {
    throw new Error('base-instructions.md must start with front matter containing "version: <value>" followed by the instructions');
  }
  return { version, text };
}

export function loadBaseInstructions(path: URL | string = DEFAULT_PATH): BaseInstructions {
  return parseBaseInstructions(readFileSync(path, 'utf8'));
}
