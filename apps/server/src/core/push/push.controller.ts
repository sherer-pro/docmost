import {
  Body,
  Controller,
  BadRequestException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { PushSubscriptionRepo } from '@docmost/db/repos/push-subscription/push-subscription.repo';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionParamsDto,
} from './dto/push-subscription.dto';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Controller('push')
export class PushController {
  constructor(
    private readonly pushSubscriptionRepo: PushSubscriptionRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Get('vapid-public-key')
  async getVapidPublicKey() {
    return {
      publicKey: this.environmentService.getWebPushVapidPublicKey(),
    };
  }

  @Post('subscriptions')
  async createSubscription(
    @Body() dto: CreatePushSubscriptionDto,
    @AuthUser() user: User,
  ) {
    const p256dh =
      dto.p256dh ?? dto.keys?.p256dh ?? dto.subscriptionKeys?.p256dh;
    const auth = dto.auth ?? dto.keys?.auth ?? dto.subscriptionKeys?.auth;

    if (!p256dh || !auth) {
      throw new BadRequestException('Missing push subscription keys');
    }

    const subscription = await this.pushSubscriptionRepo.upsert({
      endpoint: dto.endpoint,
      p256dh,
      auth,
      userId: user.id,
      workspaceId: user.workspaceId,
      userAgent: dto.userAgent,
      lastSeenAt: new Date(),
    });

    return {
      id: subscription.id,
    };
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSubscription(
    @Param() params: DeletePushSubscriptionParamsDto,
    @AuthUser() user: User,
  ) {
    const deleted = await this.pushSubscriptionRepo.revokeByIdForUser(
      params.id,
      user.id,
    );

    if (!deleted) {
      throw new NotFoundException('Push subscription not found');
    }
  }
}
