import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

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

    callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
  };
}

export function createCorsOptions(): CorsOptions {
  const allowedOrigins = getAllowedCorsOrigins();

  return {
    origin: createCorsOriginValidator(allowedOrigins),
    credentials: true,
  };
}
