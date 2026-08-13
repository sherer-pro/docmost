import type { AiProviderMessage } from '../ai.types';

export const AI_TEXT_GENERATION_PORT = Symbol('AI_TEXT_GENERATION_PORT');

export interface AiTextGenerationSession {
  complete(
    messages: AiProviderMessage[],
    options?: { temperature?: number },
  ): Promise<{ content: string }>;
}

export interface AiTextGenerationPort {
  createSession(
    spaceId: string,
    workspaceId: string,
  ): Promise<AiTextGenerationSession | null>;
}
