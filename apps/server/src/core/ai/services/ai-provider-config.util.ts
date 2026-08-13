import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { AiSpaceConfig } from '@docmost/db/types/entity.types';
import type { AiProviderConfig } from '../ai.types';
import { decryptProtectedValue } from '../../../common/security/credential-protection.util';

export async function loadAiProviderSpaceConfig(
  db: KyselyDB,
  spaceId: string,
  workspaceId: string,
): Promise<AiSpaceConfig | undefined> {
  return db
    .selectFrom('aiSpaceConfigs')
    .selectAll()
    .where('spaceId', '=', spaceId)
    .where('workspaceId', '=', workspaceId)
    .executeTakeFirst();
}

export function toAiProviderConfig(
  config: AiSpaceConfig,
  appSecret: string,
): AiProviderConfig {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKeyEncrypted
      ? decryptProtectedValue(config.apiKeyEncrypted, appSecret)
      : null,
    chatModel: config.chatModel,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}
