import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class CreatePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ValidateIf((dto: CreatePushSubscriptionDto) => !dto.keys)
  @IsString()
  @IsNotEmpty()
  p256dh?: string;

  @ValidateIf((dto: CreatePushSubscriptionDto) => !dto.keys)
  @IsString()
  @IsNotEmpty()
  auth?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys?: PushSubscriptionKeysDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  subscriptionKeys?: PushSubscriptionKeysDto;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class DeletePushSubscriptionParamsDto {
  @IsUUID()
  id: string;
}
