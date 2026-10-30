import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '../../database/pagination/pagination-options';
import { User } from '../../database/types/entity.types';
import { PageAttachmentsService } from './services/page-attachments.service';

class PageAttachmentsQuery extends PaginationOptions {
  @IsOptional() @IsString() @MaxLength(200) query: string;
}

@Controller('pages/:pageId/attachments')
@UseGuards(JwtAuthGuard)
export class PageAttachmentsController {
  constructor(private readonly attachments: PageAttachmentsService) {}

  @Get()
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  list(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Query() query: PageAttachmentsQuery,
    @AuthUser() user: User,
  ) {
    return this.attachments.list(pageId, query, user);
  }

  @Post(':attachmentId/actions/remove')
  @HttpCode(200)
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  remove(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @AuthUser() user: User,
  ) {
    return this.attachments.remove(pageId, attachmentId, user);
  }
}
