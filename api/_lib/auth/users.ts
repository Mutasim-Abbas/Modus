/**
 * The one and only place a `users` row is turned into a client-facing shape. Every
 * route that returns a user goes through this — it is the enforcement point for
 * "password hash and recovery hash never appear in any response or log"
 * (the project plan P2.2 non-negotiable), by construction: there is no code path that
 * spreads the raw row into a response.
 */

import type { users } from '../db/schema.js';

export interface PublicUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

type UserRow = typeof users.$inferSelect;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
  };
}
