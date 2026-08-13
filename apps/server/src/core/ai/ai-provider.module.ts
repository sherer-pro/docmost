import { Module } from '@nestjs/common';
import { AI_TEXT_GENERATION_PORT } from './ports/ai-text-generation.port';
import { AiOutboundUrlPolicyService } from './services/ai-outbound-url-policy.service';
import { AiProviderUrlPolicyService } from './services/ai-provider-url-policy.service';
import { AiTextGenerationService } from './services/ai-text-generation.service';
import { OpenAiCompatibleProviderService } from './services/openai-compatible-provider.service';

@Module({
  providers: [
    AiOutboundUrlPolicyService,
    AiProviderUrlPolicyService,
    OpenAiCompatibleProviderService,
    AiTextGenerationService,
    {
      provide: AI_TEXT_GENERATION_PORT,
      useExisting: AiTextGenerationService,
    },
  ],
  exports: [
    AI_TEXT_GENERATION_PORT,
    AiOutboundUrlPolicyService,
    AiProviderUrlPolicyService,
    OpenAiCompatibleProviderService,
  ],
})
export class AiProviderModule {}
