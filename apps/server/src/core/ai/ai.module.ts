import { Module } from '@nestjs/common';
import { AiContentPolicyModule } from '../ai-content-policy/ai-content-policy.module';
import { WsModule } from '../../ws/ws.module';
import { SearchModule } from '../search/search.module';
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
import { AiEditorActionController } from './controllers/ai-editor-action.controller';
import { AiRetrievalService } from './retrieval/ai-retrieval.service';
import { HttpJsonAiRetrievalAdapter } from './retrieval/http-json-ai-retrieval.adapter';
import { NoopAiRetrievalAdapter } from './retrieval/noop-ai-retrieval.adapter';
import { OpenWebUiKnowledgeRetrievalAdapter } from './retrieval/open-webui-knowledge-retrieval.adapter';
import { AiRetrievalHttpClient } from './retrieval/ai-retrieval-http-client.service';
import { AiConfigService } from './services/ai-config.service';
import { AiConversationService } from './services/ai-conversation.service';
import { AiContextService } from './services/ai-context.service';
import { AiCitationService } from './services/ai-citation.service';
import { AiFileService } from './services/ai-file.service';
import { AiOperationalMetricsService } from './services/ai-operational-metrics.service';
import { AiPromptBuilderService } from './services/ai-prompt-builder.service';
import { AiQueueReconcilerService } from './services/ai-queue-reconciler.service';
import { AiRetrievalUrlPolicyService } from './services/ai-retrieval-url-policy.service';
import { AiRunExecutionService } from './services/ai-run-execution.service';
import { AiRunEventService } from './services/ai-run-event.service';
import { AiRunService } from './services/ai-run.service';
import { AiAuxRunService } from './services/ai-aux-run.service';
import { AiAuxRunExecutionService } from './services/ai-aux-run-execution.service';
import { AiAuxRunEventService } from './services/ai-aux-run-event.service';
import { AiToolRegistryService } from './tools/ai-tool-registry.service';
import { AiBuiltinToolPolicyService } from './tools/ai-builtin-tool-policy.service';
import { AI_BUILTIN_TOOL_POLICY_RESOLVER } from './tools/ai-builtin-tool-policy.token';
import {
  AiBuiltinToolSpacePolicyController,
  AiBuiltinToolWorkspacePolicyController,
} from './controllers/ai-builtin-tool-policy.controller';
import { AiRunStepService } from './services/ai-run-step.service';
import { AiMcpUrlPolicyService } from './services/ai-mcp-url-policy.service';
import { AiMcpClientPoolService } from './mcp/ai-mcp-client-pool.service';
import { AiMcpAdminService } from './mcp/ai-mcp-admin.service';
import { AiMcpPolicyService } from './mcp/ai-mcp-policy.service';
import { AiMcpToolCallService } from './mcp/ai-mcp-tool-call.service';
import {
  AiMcpServersController,
  AiMcpSettingsController,
} from './controllers/ai-mcp-settings.controller';
import { AiMcpSpaceController } from './controllers/ai-mcp-space.controller';
import { PageModule } from '../page/page.module';
import { CollaborationClientModule } from '../../collaboration/client/collaboration-client.module';
import { ShareModule } from '../share/share.module';
import { TransclusionModule } from '../page/transclusion/transclusion.module';
import {
  AiAssistantProfileController,
  AiAssistantProfilePolicyController,
} from './controllers/ai-assistant-profile.controller';
import { AiAssistantProfileService } from './services/ai-assistant-profile.service';
import { AiSourceAccessService } from './services/ai-source-access.service';
import { AiProviderModule } from './ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { AiQueryRewriteService } from './retrieval/ai-query-rewrite.service';

@Module({
  imports: [
    AiProviderModule,
    WsModule,
    SearchModule,
    AiContentPolicyModule,
    PageModule,
    CollaborationClientModule,
    ShareModule,
    TransclusionModule,
    RagModule,
  ],
  controllers: [
    AiConfigController,
    AiStatusController,
    AiConversationController,
    AiFileController,
    AiPageAttachmentController,
    AiRunController,
    AiEditorActionController,
    AiMcpSettingsController,
    AiMcpServersController,
    AiMcpSpaceController,
    AiBuiltinToolWorkspacePolicyController,
    AiBuiltinToolSpacePolicyController,
    AiAssistantProfileController,
    AiAssistantProfilePolicyController,
  ],
  providers: [
    AiChatProcessor,
    AiConfigService,
    AiConversationService,
    AiCitationService,
    AiContextService,
    AiFileService,
    AiOperationalMetricsService,
    AiPromptBuilderService,
    AiQueueReconcilerService,
    AiRetrievalUrlPolicyService,
    AiRetrievalService,
    AiQueryRewriteService,
    AiRetrievalHttpClient,
    AiRunExecutionService,
    AiRunEventService,
    AiRunService,
    AiAuxRunService,
    AiAuxRunExecutionService,
    AiAuxRunEventService,
    AiToolRegistryService,
    AiBuiltinToolPolicyService,
    {
      provide: AI_BUILTIN_TOOL_POLICY_RESOLVER,
      useExisting: AiBuiltinToolPolicyService,
    },
    AiRunStepService,
    AiMcpUrlPolicyService,
    AiMcpClientPoolService,
    AiMcpAdminService,
    AiMcpPolicyService,
    AiMcpToolCallService,
    AiAssistantProfileService,
    AiSourceAccessService,
    HttpJsonAiRetrievalAdapter,
    OpenWebUiKnowledgeRetrievalAdapter,
    NoopAiRetrievalAdapter,
  ],
  exports: [
    AiProviderModule,
    AiConfigService,
    AiToolRegistryService,
    AiBuiltinToolPolicyService,
    AI_BUILTIN_TOOL_POLICY_RESOLVER,
  ],
})
export class AiModule {}
