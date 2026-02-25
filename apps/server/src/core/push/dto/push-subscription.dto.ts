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

  /**
   * Ручной fallback: если клиент не прислал объект `keys`/`subscriptionKeys`,
   * ключ `p256dh` должен прийти отдельным полем.
   */
  @ValidateIf(
    (dto: CreatePushSubscriptionDto) => !dto.keys && !dto.subscriptionKeys,
  )
  @IsString()
  @IsNotEmpty()
  p256dh?: string;

  /**
   * Аналогично `p256dh`: в плоском payload поле `auth` обязательно,
   * но при наличии вложенных ключей повторно его не требуем.
   */
  @ValidateIf(
    (dto: CreatePushSubscriptionDto) => !dto.keys && !dto.subscriptionKeys,
  )
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
  subscriptionKeys?: PushSubscriptionKeysDto;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class DeletePushSubscriptionParamsDto {
  @IsUUID()
  id: string;
}

export class DeletePushSubscriptionByEndpointDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}
