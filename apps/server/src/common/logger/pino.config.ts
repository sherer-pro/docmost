import { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { getClientIpFromRawRequest } from '../security/trusted-proxy.util';
import { sanitizeUrlForLogging } from './log-sanitizer.util';

const CONTEXTS_TO_IGNORE = [
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'LegacyRouteConverter',
  'WebSocketsController',
];

const SENSITIVE_ERROR_FIELDS = [
  'access_token',
  'client_assertion',
  'client_secret',
  'code',
  'code_verifier',
  'id_token',
  'password',
  'refresh_token',
  'RelayState',
  'SAMLResponse',
  'state',
] as const;

export function sanitizeLogBindings(inputArgs: unknown[]) {
  for (const arg of inputArgs) {
    if (typeof arg !== 'object' || arg === null) {
      continue;
    }

    const bindings = arg as Record<string, unknown>;
    const request = bindings.req;
    if (typeof request === 'object' && request !== null) {
      const requestRecord = request as Record<string, unknown>;
      requestRecord.url = sanitizeUrlForLogging(requestRecord.url);
    }

    const error = bindings.err;
    if (typeof error === 'object' && error !== null) {
      const errorRecord = error as Record<string, unknown>;
      if ('params' in errorRecord) {
        errorRecord.params = '[Redacted]';
      }
      for (const field of SENSITIVE_ERROR_FIELDS) {
        if (field in errorRecord) {
          errorRecord[field] = '[Redacted]';
        }
      }
    }
  }
}

export function createPinoConfig(): Params {
  const isProduction = process.env.NODE_ENV?.toLowerCase() === 'production';
  const isDebugMode = process.env.DEBUG_MODE?.toLowerCase() === 'true';
  const logHttp = process.env.LOG_HTTP?.toLowerCase() === 'true';

  const level = isProduction && !isDebugMode ? 'info' : 'debug';

  return {
    pinoHttp: {
      level,
      timestamp: stdTimeFunctions.isoTime,
      transport: !isProduction
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      formatters: {
        level: (label) => ({ level: label }),
      },
      hooks: {
        logMethod(inputArgs, method) {
          sanitizeLogBindings(inputArgs);
          if (isProduction && !isDebugMode) {
            for (const arg of inputArgs) {
              if (typeof arg === 'object' && arg !== null && 'context' in arg) {
                const context = (arg as Record<string, unknown>)['context'];
                if (
                  typeof context === 'string' &&
                  CONTEXTS_TO_IGNORE.includes(context)
                ) {
                  return;
                }
              }
            }
          }
          return method.apply(this, inputArgs);
        },
      },
      serializers: {
        req: (req) => {
          return {
            method: req.method,
            url: sanitizeUrlForLogging(req.url),
            ip: getClientIpFromRawRequest(req),
            userAgent: req.headers?.['user-agent'],
          };
        },
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: logHttp
        ? {
            ignore: (req) =>
              req.url === '/api/health' || req.url === '/api/health/live',
          }
        : false,
    },
  };
}
