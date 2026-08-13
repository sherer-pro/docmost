import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import type {
  AiTextGenerationPort,
  AiTextGenerationSession,
} from '../ports/ai-text-generation.port';
import { OpenAiCompatibleProviderService } from './openai-compatible-provider.service';
import {
  loadAiProviderSpaceConfig,
  toAiProviderConfig,
} from './ai-provider-config.util';

@Injectable()
export class AiTextGenerationService implements AiTextGenerationPort {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly provider: OpenAiCompatibleProviderService,
  ) {}

  async createSession(
    spaceId: string,
    workspaceId: string,
  ): Promise<AiTextGenerationSession | null> {
    const config = await loadAiProviderSpaceConfig(
      this.db,
      spaceId,
      workspaceId,
    );
    if (!config?.enabled || !config.baseUrl || !config.chatModel) {
      return null;
    }

    const providerConfig = toAiProviderConfig(
      config,
      this.environmentService.getAppSecret(),
    );

    return {
      complete: (messages, options) =>
        this.provider.complete(
          {
            ...providerConfig,
            ...options,
          },
          messages,
        ),
    };
  }
}
