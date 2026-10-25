/**
 * Database availability. Lets each route decide what still works when MongoDB is unreachable, instead of the whole
 * API failing together.
 */
import mongoose from 'mongoose';
import { AppError } from './errors.js';

export const isDbConnected = () => mongoose.connection.readyState === 1;

const UNAVAILABLE_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

/** True for errors that mean "the database cannot be reached", as opposed to a bad query or a duplicate key. */
export function isDbUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (UNAVAILABLE_NAMES.has(err.name)) return true;
  return /buffering timed out|before initial connection|client must be connected|connection .* closed|topology .* closed/i.test(err.message);
}

export const dbUnavailable = () =>
  new AppError(503, 'DB_UNAVAILABLE', 'Saved data is temporarily unavailable. Reading pages still works. Try again in a minute.', 30);
