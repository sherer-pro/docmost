import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiOutboundUrlPolicyService } from './ai-outbound-url-policy.service';

@Injectable()
export class AiRetrievalUrlPolicyService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly outboundPolicy: AiOutboundUrlPolicyService,
  ) {}

  async assertAllowed(rawUrl: string): Promise<URL> {
    return this.outboundPolicy.assertAllowed(rawUrl, {
      kind: 'retrieval',
      allowedOrigins:
        this.environmentService.getAiRetrievalAllowedOrigins(),
      allowQuery: true,
    });
  }
}
