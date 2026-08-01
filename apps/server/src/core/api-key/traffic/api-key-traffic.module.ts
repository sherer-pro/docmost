import { Module } from '@nestjs/common';
import { ApiKeyTrafficGuard } from './api-key-traffic.guard';
import { ApiKeyTrafficService } from './api-key-traffic.service';

@Module({
  providers: [ApiKeyTrafficService, ApiKeyTrafficGuard],
  exports: [ApiKeyTrafficService, ApiKeyTrafficGuard],
})
export class ApiKeyTrafficModule {}
