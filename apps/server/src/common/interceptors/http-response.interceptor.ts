import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { ApiResponseEnvelope } from '@docmost/api-contract';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

@Injectable()
export class TransformHttpResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseEnvelope<T> | T>
{
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseEnvelope<T> | T> {
    const skipTransform = this.reflector.get(
      SKIP_TRANSFORM_KEY,
      context.getHandler(),
    );

    if (skipTransform) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const status = context.switchToHttp().getResponse().statusCode;

        return { data, success: true, status };
      }),
    );
  }
}
