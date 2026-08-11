import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { safeStringEqual } from '../../common/security/credential-protection.util';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CollaborationGateway } from '../collaboration.gateway';
import type {
  CollaborationCommandName,
  CollaborationCommandRequest,
} from '../collaboration-document.port';

const COMMAND_NAMES = new Set<CollaborationCommandName>([
  'updatePageContent',
  'applyAiPageOperation',
  'applyPageTemplateMutation',
  'getAiPageContentHash',
  'getAiPageContent',
]);
const DOCUMENT_NAME_PATTERN = /^page\.[0-9a-f-]{36}$/i;

@Controller('internal/collaboration')
export class CollaborationInternalController {
  constructor(
    private readonly collaboration: CollaborationGateway,
    private readonly environment: EnvironmentService,
  ) {}

  @Post('commands')
  @SkipTransform()
  async handleCommand(
    @Headers('x-docmost-collab-secret') suppliedSecret: string | undefined,
    @Body() body: CollaborationCommandRequest,
  ): Promise<{ result: unknown }> {
    if (
      !suppliedSecret ||
      !safeStringEqual(
        suppliedSecret,
        this.environment.getCollabInternalSecret(),
      )
    ) {
      throw new UnauthorizedException();
    }

    if (
      !body ||
      !COMMAND_NAMES.has(body.eventName) ||
      !DOCUMENT_NAME_PATTERN.test(body.documentName) ||
      !body.payload ||
      typeof body.payload !== 'object' ||
      typeof body.payload.user?.id !== 'string'
    ) {
      throw new BadRequestException('Invalid collaboration command');
    }

    try {
      const result = await this.collaboration.handleYjsEvent(
        body.eventName,
        body.documentName,
        body.payload as never,
      );
      return { result };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const code = error instanceof Error ? error.message : '';
      if (
        code === 'agent_write_stale' ||
        code === 'agent_write_recovery_mismatch'
      ) {
        throw new ConflictException({ code, message: code });
      }
      throw error;
    }
  }
}
