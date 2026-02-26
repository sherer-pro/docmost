import { Global, Module } from '@nestjs/common';
import { EnvironmentModule } from '../../integrations/environment/environment.module';
import { AuthCookieService } from './auth-cookie.service';
import { CsrfService } from './csrf.service';

@Global()
@Module({
  imports: [EnvironmentModule],
  providers: [CsrfService, AuthCookieService],
  exports: [CsrfService, AuthCookieService],
})
export class CommonSecurityModule {}
