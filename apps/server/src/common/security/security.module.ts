import { Global, Module } from '@nestjs/common';
import { EnvironmentModule } from '../../integrations/environment/environment.module';
import { CsrfService } from './csrf.service';

@Global()
@Module({
  imports: [EnvironmentModule],
  providers: [CsrfService],
  exports: [CsrfService],
})
export class CommonSecurityModule {}
