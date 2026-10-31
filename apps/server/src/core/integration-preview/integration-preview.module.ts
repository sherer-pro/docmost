import { Module } from '@nestjs/common';
import { PageAccessModule } from '../page-access/page-access.module';
import { AiOutboundUrlPolicyService } from '../ai/services/ai-outbound-url-policy.service';
import { IntegrationPreviewController } from './integration-preview.controller';
import { IntegrationPreviewService } from './integration-preview.service';
import { IntegrationPreviewHttpService } from './integration-preview-http.service';

@Module({
  imports: [PageAccessModule],
  controllers: [IntegrationPreviewController],
  providers: [
    IntegrationPreviewService,
    IntegrationPreviewHttpService,
    AiOutboundUrlPolicyService,
  ],
})
export class IntegrationPreviewModule {}
