import { applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  DeprecatedRouteInterceptor,
  DeprecatedRouteOptions,
} from '../interceptors/deprecated-route.interceptor';

export const DeprecatedRoute = (options: DeprecatedRouteOptions) =>
  applyDecorators(UseInterceptors(new DeprecatedRouteInterceptor(options)));
