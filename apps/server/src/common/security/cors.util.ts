import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEFAULT_ORIGIN = 'http://localhost:3000';

function safeGetOrigin(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getAllowedCorsOrigins(): string[] {
  const origins = new Set<string>();

  const appOrigin = safeGetOrigin(process.env.APP_URL);
  const collabOrigin = safeGetOrigin(process.env.COLLAB_URL);

  if (appOrigin) {
    origins.add(appOrigin);
  }

  if (collabOrigin) {
    origins.add(collabOrigin);
  }

  if (origins.size === 0) {
    origins.add(DEFAULT_ORIGIN);
  }

  return Array.from(origins);
}

export function createCorsOriginValidator(allowedOrigins = getAllowedCorsOrigins()) {
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

export function createCorsOptions(): CorsOptions {
  const allowedOrigins = getAllowedCorsOrigins();

  return {
    origin: createCorsOriginValidator(allowedOrigins),
    credentials: true,
  };
}

export function createApplicationCorsOptions(): CorsOptionsDelegate<any> {
  const authenticated = createCorsOptions();
  const publicPaths = new Set([
    '/mcp',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/api/mcp-oauth/clients',
    '/api/mcp-oauth/token',
    '/api/mcp-oauth/revoke',
  ]);
  return (request, callback) => {
    const path = String(request.raw?.url ?? request.url ?? '').split('?')[0];
    callback(null, publicPaths.has(path) ? {
      origin: '*', credentials: false,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
      exposedHeaders: ['WWW-Authenticate', 'Retry-After', 'Mcp-Session-Id'],
    } : authenticated);
  };
}
