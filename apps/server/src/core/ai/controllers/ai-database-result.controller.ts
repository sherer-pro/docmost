import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiDatabaseResultService } from '../services/ai-database-result.service';

export class AiDatabaseResultQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  cursor?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('ai/runs/:runId')
export class AiDatabaseResultController {
  constructor(private readonly results: AiDatabaseResultService) {}

  @Get('database-results')
  list(
    @Param('runId', ParseUUIDPipe) runId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.results.list(runId, user, workspace);
  }

  @Get('steps/:stepId/database-result')
  rows(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Query() query: AiDatabaseResultQueryDto,
    @Req() request: FastifyRequest,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (Object.keys(request.query ?? {}).some((key) => key !== 'cursor')) {
      throw new BadRequestException('Only the result cursor may be supplied');
    }
    return this.results.rows(runId, stepId, query.cursor, user, workspace);
  }
}
