import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import type {
  CollaborationCommandHandlers,
  CollaborationCommandName,
  CollaborationCommandRequest,
  CollaborationDocumentPort,
} from '../collaboration-document.port';

const COLLABORATION_COMMAND_TIMEOUT_MS = 30_000;
const COLLABORATION_UNAVAILABLE_RESPONSE = {
  code: 'collaboration_unavailable',
  message: 'Collaboration service is unavailable',
} as const;

type CollaborationCommandResponse<T> = {
  result: T;
};

@Injectable()
export class CollaborationHttpClientService
  implements CollaborationDocumentPort
{
  private readonly logger = new Logger(CollaborationHttpClientService.name);

  constructor(private readonly environment: EnvironmentService) {}

  updatePageContent(
    documentName: string,
    payload: Parameters<CollaborationCommandHandlers['updatePageContent']>[1],
  ) {
    return this.sendCommand('updatePageContent', documentName, payload);
  }

  applyAiPageOperation(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['applyAiPageOperation']
    >[1],
  ) {
    return this.sendCommand('applyAiPageOperation', documentName, payload);
  }

  applyPageTemplateMutation(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['applyPageTemplateMutation']
    >[1],
  ) {
    return this.sendCommand('applyPageTemplateMutation', documentName, payload);
  }

  getPageContentHash(
    documentName: string,
    payload: Parameters<
      CollaborationCommandHandlers['getAiPageContentHash']
    >[1],
  ) {
    return this.sendCommand('getAiPageContentHash', documentName, payload);
  }

  getPageContent(
    documentName: string,
    payload: Parameters<CollaborationCommandHandlers['getAiPageContent']>[1],
  ) {
    return this.sendCommand('getAiPageContent', documentName, payload);
  }

  private async sendCommand<TName extends CollaborationCommandName>(
    eventName: TName,
    documentName: string,
    payload: Parameters<CollaborationCommandHandlers[TName]>[1],
  ): Promise<Awaited<ReturnType<CollaborationCommandHandlers[TName]>>> {
    const request: CollaborationCommandRequest<TName> = {
      eventName,
      documentName,
      payload: {
        ...payload,
        user: { id: payload.user.id },
      },
    };
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COLLABORATION_COMMAND_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        new URL(
          '/api/internal/collaboration/commands',
          this.environment.getCollabInternalUrl(),
        ),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-docmost-collab-secret':
              this.environment.getCollabInternalSecret(),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const remoteError = await this.readRemoteError(response);
        if (response.status === 400) {
          throw new BadRequestException(remoteError);
        }
        if (response.status === 409) {
          throw new ConflictException(remoteError);
        }
        throw new ServiceUnavailableException(
          COLLABORATION_UNAVAILABLE_RESPONSE,
        );
      }

      const body = (await response.json()) as CollaborationCommandResponse<
        Awaited<ReturnType<CollaborationCommandHandlers[TName]>>
      >;
      return body.result as Awaited<
        ReturnType<CollaborationCommandHandlers[TName]>
      >;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      this.logger.warn(
        `Collaboration command failed: ${eventName}; document=${documentName}`,
      );
      throw new ServiceUnavailableException(COLLABORATION_UNAVAILABLE_RESPONSE);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readRemoteError(
    response: Response,
  ): Promise<{ code?: string; message: string }> {
    try {
      const body = (await response.json()) as {
        code?: unknown;
        message?: unknown;
      };
      return {
        ...(typeof body.code === 'string' ? { code: body.code } : {}),
        message:
          typeof body.message === 'string'
            ? body.message
            : 'Collaboration command was rejected',
      };
    } catch {
      return { message: 'Collaboration command was rejected' };
    }
  }
}
