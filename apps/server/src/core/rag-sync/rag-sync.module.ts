import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import {
  RAG_SYNC_CONTROL,
  RAG_SYNC_OPERATION_LOCK,
  RAG_SYNC_STATUS_READER,
  RAG_SYNC_WRITER,
  RagSyncAdminController,
  RagSyncAdminRepo,
  RagSyncAdminService,
} from './admin';
import {
  RagSyncBindingRegistryService,
  RagSyncSourceService,
} from './integration';
import {
  OpenWebUiWriterService,
  RAG_SYNC_BINDING_REGISTRY,
  RAG_SYNC_QUANTUM_PROCESSOR,
  RagSyncBindingRuntime,
  RagSyncMemoryBudgetService,
  RagSyncRuntimeConfigService,
  RagSyncStateStore,
  RagSyncSupervisorService,
} from './runtime';

@Module({
  imports: [AiProviderModule, RagModule],
  controllers: [RagSyncAdminController],
  providers: [
    RagSyncAdminRepo,
    RagSyncAdminService,
    RagSyncRuntimeConfigService,
    RagSyncStateStore,
    RagSyncMemoryBudgetService,
    OpenWebUiWriterService,
    RagSyncBindingRegistryService,
    RagSyncSourceService,
    RagSyncBindingRuntime,
    RagSyncSupervisorService,
    {
      provide: RAG_SYNC_WRITER,
      useExisting: OpenWebUiWriterService,
    },
    {
      provide: RAG_SYNC_STATUS_READER,
      useExisting: RagSyncStateStore,
    },
    {
      provide: RAG_SYNC_OPERATION_LOCK,
      useExisting: RagSyncStateStore,
    },
    {
      provide: RAG_SYNC_CONTROL,
      useExisting: RagSyncSupervisorService,
    },
    {
      provide: RAG_SYNC_BINDING_REGISTRY,
      useExisting: RagSyncBindingRegistryService,
    },
    {
      provide: RAG_SYNC_QUANTUM_PROCESSOR,
      useExisting: RagSyncSourceService,
    },
  ],
})
export class RagSyncModule {}
