import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { PerformanceDiagnosticsService } from './performance-diagnostics.service';

interface RouteAwareRequest {
  method?: string;
  routeOptions?: { url?: string };
}

interface HeaderReply {
  statusCode?: number;
  header?: (name: string, value: string) => void;
}

export function getPerformanceRouteTemplate(
  request: RouteAwareRequest,
): string | null {
  const template = request.routeOptions?.url?.split('?')[0];
  if (!template || !template.startsWith('/') || template.length > 200) {
    return null;
  }

  return template.startsWith('/api') ? template : `/api${template}`;
}

@Injectable()
export class PerformanceDiagnosticsInterceptor implements NestInterceptor {
  constructor(private readonly diagnostics: PerformanceDiagnosticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.diagnostics.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RouteAwareRequest>();
    const reply = context.switchToHttp().getResponse<HeaderReply>();
    const route = getPerformanceRouteTemplate(request);
    if (!route) {
      return next.handle();
    }

    const method = request.method?.toUpperCase() ?? 'UNKNOWN';
    const startedAt = performance.now();
    let statusCode = reply.statusCode ?? 200;
    this.diagnostics.beginRequest();

    const setTimingHeader = () => {
      const durationMs = performance.now() - startedAt;
      reply.header?.('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
      return durationMs;
    };

    return next.handle().pipe(
      tap(() => {
        statusCode = reply.statusCode ?? statusCode;
        setTimingHeader();
      }),
      catchError((error) => {
        statusCode =
          typeof error?.getStatus === 'function'
            ? error.getStatus()
            : (reply.statusCode ?? 500);
        setTimingHeader();
        return throwError(() => error);
      }),
      finalize(() => {
        this.diagnostics.recordRequest({
          method,
          route,
          statusCode,
          durationMs: performance.now() - startedAt,
        });
      }),
    );
  }
}
