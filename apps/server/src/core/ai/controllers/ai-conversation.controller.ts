import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AiConversationListQueryDto,
  AiContextDescendantsQueryDto,
  AiContextSourceSearchQueryDto,
  AiMessagesQueryDto,
  CreateAiConversationDto,
  UpdateAiConversationContextDto,
  UpdateAiConversationDto,
} from '../dto/ai.dto';
import { AiConversationService } from '../services/ai-conversation.service';
import { AiContextService } from '../services/ai-context.service';

@UseGuards(JwtAuthGuard)
@Controller('ai/conversations')
export class AiConversationController {
  constructor(
    private readonly conversations: AiConversationService,
    private readonly contexts: AiContextService,
  ) {}

  @Get()
  list(
    @Query() query: AiConversationListQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.list(query.pageId, user, workspace);
  }

  @Post()
  create(
    @Body() dto: CreateAiConversationDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.create(dto, user, workspace);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.get(id, user, workspace);
  }

  @Post(':id/actions/open')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.open(id, user, workspace);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiConversationDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.update(id, dto, user, workspace);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.remove(id, user, workspace);
  }

  @Get(':id/messages')
  messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AiMessagesQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.conversations.listMessages(id, query, user, workspace);
  }

  @Get(':id/context')
  context(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.contexts.get(id, user, workspace);
  }

  @Put(':id/context')
  updateContext(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiConversationContextDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.contexts.update(id, dto, user, workspace);
  }

  @Get(':id/context-sources')
  contextSources(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AiContextSourceSearchQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.contexts.search(id, query, user, workspace);
  }

  @Get(':id/context-descendants')
  contextDescendants(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AiContextDescendantsQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.contexts.descendants(id, query, user, workspace);
  }
}
