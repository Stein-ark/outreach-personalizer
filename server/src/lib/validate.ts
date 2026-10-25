/**
 * Request validation with the shared zod schemas. A failed parse becomes a 400 with field level messages,
 * never the raw input.
 */
import type { z } from 'zod';

export class ValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super('Validation failed');
  }
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}
