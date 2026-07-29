import { Module } from '@nestjs/common';
import { WsModule } from '../../ws/ws.module';
import { AiChatProcessor } from './ai-chat.processor';
import {
  AiConfigController,
  AiStatusController,
} from './controllers/ai-config.controller';
import { AiConversationController } from './controllers/ai-conversation.controller';
import {
  AiFileController,
  AiPageAttachmentController,
} from './controllers/ai-file.controller';
import { AiRunController } from './controllers/ai-run.controller';
import { AiRetrievalService } from './retrieval/ai-retrieval.service';
import { HttpJsonAiRetrievalAdapter } from './retrieval/http-json-ai-retrieval.adapter';
import { NoopAiRetrievalAdapter } from './retrieval/noop-ai-retrieval.adapter';
import { AiConfigService } from './services/ai-config.service';
import { AiConversationService } from './services/ai-conversation.service';
import { AiFileService } from './services/ai-file.service';
import { AiOutboundUrlPolicyService } from './services/ai-outbound-url-policy.service';
import { AiOperationalMetricsService } from './services/ai-operational-metrics.service';
import { AiProviderUrlPolicyService } from './services/ai-provider-url-policy.service';
import { AiPromptBuilderService } from './services/ai-prompt-builder.service';
import { AiQueueReconcilerService } from './services/ai-queue-reconciler.service';
import { AiRetrievalUrlPolicyService } from './services/ai-retrieval-url-policy.service';
import { AiRunExecutionService } from './services/ai-run-execution.service';
import { AiRunEventService } from './services/ai-run-event.service';
import { AiRunService } from './services/ai-run.service';
import { OpenAiCompatibleProviderService } from './services/openai-compatible-provider.service';

@Module({
  imports: [WsModule],
  controllers: [
    AiConfigController,
    AiStatusController,
    AiConversationController,
    AiFileController,
    AiPageAttachmentController,
    AiRunController,
  ],
  providers: [
    AiChatProcessor,
    AiConfigService,
    AiConversationService,
    AiFileService,
    AiOutboundUrlPolicyService,
    AiOperationalMetricsService,
    AiProviderUrlPolicyService,
    AiPromptBuilderService,
    AiQueueReconcilerService,
    AiRetrievalUrlPolicyService,
    AiRetrievalService,
    AiRunExecutionService,
    AiRunEventService,
    AiRunService,
    HttpJsonAiRetrievalAdapter,
    NoopAiRetrievalAdapter,
    OpenAiCompatibleProviderService,
  ],
  exports: [AiConfigService],
})
export class AiModule {}
