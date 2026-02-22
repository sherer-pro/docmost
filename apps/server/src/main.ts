import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { TransformHttpResponseInterceptor } from './common/interceptors/http-response.interceptor';
import { WsRedisIoAdapter } from './ws/adapter/ws-redis.adapter';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { InternalLogFilter } from './common/logger/internal-log-filter';

/**
 * Returns the origin from a URL string when parsing succeeds.
 *
 * @param value URL string from an environment variable.
 * @returns Origin (`https://example.com`) or `null` if the input is invalid.
 */
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

/**
 * Builds the baseline CSP directives for API/static responses without inline scripts.
 *
 * WebSocket schemes are included in `connect-src` to keep realtime traffic and
 * requests to a dedicated collab endpoint working.
 *
 * @returns CSP directives for the `Content-Security-Policy` header.
 */
function buildBaseCspDirectives() {
  const appOrigin = safeGetOrigin(process.env.APP_URL);
  const collabOrigin = safeGetOrigin(process.env.COLLAB_URL);

  const connectSrc = [
    "'self'",
    'https:',
    'wss:',
    'ws:',
    appOrigin,
    collabOrigin,
  ].filter(Boolean);

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    objectSrc: ["'none'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:', 'https:'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
    scriptSrc: ["'self'"],
    connectSrc,
    upgradeInsecureRequests: [],
  };
}

/**
 * Converts a CSP directives object into a `Content-Security-Policy` header value.
 *
 * @param directives CSP directives map.
 * @returns Header string in `directive value; directive value` format.
 */
function buildCspHeaderValue(
  directives: Record<string, Array<string>>,
): string {
  /**
   * Converts a CSP directive name from camelCase to kebab-case.
   *
   * Browsers only recognize standard directive names such as
   * `default-src`, `frame-ancestors`, and `upgrade-insecure-requests`.
   *
   * @param directive Directive name in camelCase or kebab-case.
   * @returns Normalized directive name in kebab-case.
   */
  const toCspDirectiveName = (directive: string): string =>
    directive.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

  return Object.entries(directives)
    .map(([directive, values]) => {
      const normalizedDirective = toCspDirectiveName(directive);

      if (!values.length) {
        return normalizedDirective;
      }

      return `${normalizedDirective} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * Builds a relaxed CSP for SPA routes that rely on inline config (`window.CONFIG`).
 *
 * This relaxation is intentionally scoped to HTML routes (e.g. editor/preview/share)
 * to avoid weakening CSP for API responses.
 *
 * @returns CSP directives for relaxed mode.
 */
function buildRelaxedCspDirectives() {
  return {
    ...buildBaseCspDirectives(),
    scriptSrc: ["'self'", "'unsafe-inline'"],
  };
}

/**
 * Determines whether the current URL should use the relaxed CSP policy.
 *
 * @param requestUrl Request URL.
 * @returns `true` for frontend/share pages that expect inline scripts.
 */
function shouldUseRelaxedCsp(requestUrl: string): boolean {
  return !requestUrl.startsWith('/api');
}

/**
 * Builds security headers for a request.
 *
 * HSTS is added only for HTTPS traffic, including traffic forwarded as HTTPS
 * via `x-forwarded-proto`.
 *
 * @param requestUrl Request URL.
 * @param isHttps Indicates whether the request is HTTPS.
 * @returns Security headers for the response.
 */
function getSecurityHeaders(
  requestUrl: string,
  isHttps: boolean,
): Record<string, string> {
  const cspDirectives = shouldUseRelaxedCsp(requestUrl)
    ? buildRelaxedCspDirectives()
    : buildBaseCspDirectives();

  const headers: Record<string, string> = {
    'content-security-policy': buildCspHeaderValue(cspDirectives),
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
  };

  if (isHttps) {
    headers['strict-transport-security'] =
      'max-age=31536000; includeSubDomains; preload';
  }

  return headers;
}

/**
 * Applies request-specific security headers to the Fastify response.
 *
 * @param requestUrl Request URL.
 * @param isHttps Indicates whether the request is HTTPS.
 * @param reply Fastify reply instance.
 */
function applySecurityHeaders(
  requestUrl: string,
  isHttps: boolean,
  reply: { header: (name: string, value: string) => void },
) {
  const headers = getSecurityHeaders(requestUrl, isHttps);

  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      routerOptions: {
        maxParamLength: 1000,
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
    }),
    {
      rawBody: true,
      // captures NestJS internal errors
      logger: new InternalLogFilter(),
      // bufferLogs must be false else pino will fail
      // to log OnApplicationBootstrap logs
      bufferLogs: false,
    },
  );

  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api', {
    exclude: ['robots.txt', 'share/:shareId/p/:pageSlug'],
  });

  const reflector = app.get(Reflector);
  const redisIoAdapter = new WsRedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useWebSocketAdapter(redisIoAdapter);

  await app.register(fastifyMultipart);
  await app.register(fastifyCookie);

  app
    .getHttpAdapter()
    .getInstance()
    .decorateReply('setHeader', function (name: string, value: unknown) {
      this.header(name, value);
    })
    .decorateReply('end', function () {
      this.send('');
    })
    .addHook('preHandler', function (req, reply, done) {
      const forwardedProtoHeader = req.headers['x-forwarded-proto'];
      const isForwardedHttps = Array.isArray(forwardedProtoHeader)
        ? forwardedProtoHeader.some((value) => value.includes('https'))
        : forwardedProtoHeader?.includes('https');
      const isHttps = req.protocol === 'https' || Boolean(isForwardedHttps);

      applySecurityHeaders(req.originalUrl, isHttps, reply);

      // don't require workspaceId for the following paths
      const excludedPaths = [
        '/api/auth/setup',
        '/api/health',
        '/api/billing/stripe/webhook',
        '/api/workspace/check-hostname',
        '/api/sso/google',
        '/api/workspace/create',
        '/api/workspace/joined',
      ];

      if (
        req.originalUrl.startsWith('/api') &&
        !excludedPaths.some((path) => req.originalUrl.startsWith(path))
      ) {
        if (!req.raw?.['workspaceId'] && req.originalUrl !== '/api') {
          throw new NotFoundException('Workspace not found');
        }
        done();
      } else {
        done();
      }
    });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      stopAtFirstError: true,
      transform: true,
    }),
  );

  app.enableCors();
  app.useGlobalInterceptors(new TransformHttpResponseInterceptor(reflector));
  app.enableShutdownHooks();

  const logger = new Logger('NestApplication');

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`UnhandledRejection, reason: ${reason}`, promise);
  });

  process.on('uncaughtException', (error) => {
    logger.error('UncaughtException:', error);
  });

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host, () => {
    logger.log(
      `Listening on http://127.0.0.1:${port} / ${process.env.APP_URL}`,
    );
  });
}

bootstrap();
