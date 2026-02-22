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
 * Возвращает origin из URL-строки, если её удалось корректно распарсить.
 *
 * @param value Строка URL из переменной окружения.
 * @returns Origin (`https://example.com`) или `null`, если вход невалидный.
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
 * Строит базовый набор CSP-директив для API/статических ответов без inline-скриптов.
 *
 * В `connect-src` явно добавляем websocket-схемы, чтобы не ломать realtime-подключения
 * и клиентские запросы к отдельному collab endpoint.
 *
 * @returns CSP-директивы для заголовка `Content-Security-Policy`.
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
 * Преобразует объект CSP-директив в строку заголовка `Content-Security-Policy`.
 *
 * @param directives Набор директив CSP.
 * @returns Строка формата `directive value; directive value`.
 */
function buildCspHeaderValue(
  directives: Record<string, Array<string>>,
): string {
  return Object.entries(directives)
    .map(([directive, values]) => {
      if (!values.length) {
        return directive;
      }

      return `${directive} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * Формирует смягчённую CSP для SPA-страниц, где используется inline-конфиг (`window.CONFIG`).
 *
 * Это точечное послабление применяется только к HTML-роутам (например, editor/preview/share),
 * чтобы не ослаблять политику для API-ответов.
 *
 * @returns CSP-директивы для «relaxed» режима.
 */
function buildRelaxedCspDirectives() {
  return {
    ...buildBaseCspDirectives(),
    scriptSrc: ["'self'", "'unsafe-inline'"],
  };
}

/**
 * Определяет, нужен ли relaxed CSP для текущего URL.
 *
 * @param requestUrl URL запроса.
 * @returns `true`, если это страница frontend/share, где ожидаются inline-скрипты.
 */
function shouldUseRelaxedCsp(requestUrl: string): boolean {
  return !requestUrl.startsWith('/api');
}

/**
 * Собирает security-заголовки для конкретного запроса.
 *
 * HSTS включаем только для HTTPS-трафика (включая проксированный через `x-forwarded-proto`).
 *
 * @param requestUrl URL запроса.
 * @param isHttps Флаг HTTPS-соединения.
 * @returns Набор заголовков безопасности для текущего ответа.
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
 * Применяет security-заголовки к ответу.
 *
 * @param requestUrl URL запроса.
 * @param isHttps Флаг HTTPS-соединения.
 * @param reply Fastify-ответ.
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
