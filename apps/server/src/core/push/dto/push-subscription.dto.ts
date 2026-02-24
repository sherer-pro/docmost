import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class DeletePushSubscriptionParamsDto {
  @IsUUID()
  id: string;
}
