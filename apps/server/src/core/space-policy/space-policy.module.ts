import { Global, Module } from '@nestjs/common';
import { SpacePolicyService } from './space-policy.service';
import { AuthenticationAssuranceService } from './authentication-assurance.service';

@Global()
@Module({
  providers: [SpacePolicyService, AuthenticationAssuranceService],
  exports: [SpacePolicyService, AuthenticationAssuranceService],
})
export class SpacePolicyModule {}
