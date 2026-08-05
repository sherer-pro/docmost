import * as postgresImport from 'postgres';

type PostgresFactory = typeof postgresImport;

function resolvePostgresFactory(): PostgresFactory {
  const directImport: unknown = postgresImport;
  if (typeof directImport === 'function') {
    return directImport as PostgresFactory;
  }

  const defaultImport = (directImport as { default?: unknown })?.default;
  if (typeof defaultImport === 'function') {
    return defaultImport as PostgresFactory;
  }

  throw new TypeError('The postgres module does not export a callable client');
}

export const postgres = resolvePostgresFactory();
