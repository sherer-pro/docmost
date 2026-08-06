import { sql } from 'kysely';

export function postgresJsonb(value: unknown) {
  // Postgres.js serializes parameters using the inferred jsonb type. A
  // pre-stringified value would be encoded again and stored as a JSON string.
  return sql`${value}::jsonb`;
}
