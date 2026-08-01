import { Global, Module } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { ConfigModule } from '@nestjs/config';
import { validate } from './environment.validation';
import { envPath } from '../../common/helpers';
import { DomainService } from './domain.service';
import { SsoEndpointPolicyService } from './sso-endpoint-policy.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: envPath,
      validate,
    }),
  ],
  providers: [EnvironmentService, DomainService, SsoEndpointPolicyService],
  exports: [EnvironmentService, DomainService, SsoEndpointPolicyService],
})
export class EnvironmentModule {}
