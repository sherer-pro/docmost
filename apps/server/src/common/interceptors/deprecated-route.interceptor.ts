import {
  CallHandler,
  ExecutionContext,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

export type DeprecatedRouteOptions = {
  sunset: string;
  replacement: string;
};

export class DeprecatedRouteInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeprecatedRouteInterceptor.name);

  constructor(private readonly options: DeprecatedRouteOptions) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    res.header('Deprecation', 'true');
    res.header('Sunset', this.options.sunset);

    const logPayload = {
      deprecated_route: true,
      replacement: this.options.replacement,
      sunset: this.options.sunset,
      method: req?.method,
      path: req?.url,
    };

    if (req?.log?.warn) {
      req.log.warn(logPayload, 'Deprecated API alias route was called');
    } else {
      this.logger.warn(JSON.stringify(logPayload));
    }

    return next.handle();
  }
}
