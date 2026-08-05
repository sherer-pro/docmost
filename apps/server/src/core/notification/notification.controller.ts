import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User } from '@docmost/db/types/entity.types';
import { MarkNotificationsReadDto } from './dto/notification.dto';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @HttpCode(HttpStatus.OK)
  @Get('/')
  async getNotificationsViaQuery(
    @Query() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    return this.getNotifications(pagination, user);
  }

  @HttpCode(HttpStatus.OK)
  @Get('unread-count')
  async getUnreadCountViaGet(@AuthUser() user: User) {
    return this.getUnreadCount(user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('mark-read')
  async markAsRead(
    @Body() dto: MarkNotificationsReadDto,
    @AuthUser() user: User,
  ) {
    if (dto.notificationIds?.length) {
      await this.notificationService.markMultipleAsRead(
        dto.notificationIds,
        user.id,
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('mark-all-read')
  async markAllAsRead(@AuthUser() user: User) {
    await this.notificationService.markAllAsRead(user.id);
  }

  async getNotifications(
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    return this.notificationService.findByUserId(user.id, pagination);
  }

  async getUnreadCount(@AuthUser() user: User) {
    const count = await this.notificationService.getUnreadCount(user.id);
    return { count };
  }
}
