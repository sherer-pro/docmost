import { NestFactory, Reflector } from '@nestjs/core';
import { CollabAppModule } from './collab-app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { TransformHttpResponseInterceptor } from '../../common/interceptors/http-response.interceptor';
import { Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { InternalLogFilter } from '../../common/logger/internal-log-filter';
import { createCorsOptions } from '../../common/security/cors.util';
import { EnvironmentService } from '../../integrations/environment/environment.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    CollabAppModule,
    new FastifyAdapter({
      routerOptions: {
        maxParamLength: 1000,
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
    }),
    {
      logger: new InternalLogFilter(),
      bufferLogs: false,
    },
  );

  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api', { exclude: ['/'] });

  app.enableCors(createCorsOptions());

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new TransformHttpResponseInterceptor(reflector));
  app.enableShutdownHooks();

  const logger = new Logger('CollabServer');
  const environmentService = app.get(EnvironmentService);

  const port = environmentService.getCollabPort();
  const host = environmentService.getHost();
  await app.listen(port, host, () => {
    logger.log(`Listening on http://127.0.0.1:${port}`);
  });
}

bootstrap();
