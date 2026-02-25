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
   * Manual fallback: if the client does not send a `keys`/`subscriptionKeys` object,
   * the `p256dh` key must be provided as a separate field.
   */
  @ValidateIf(
    (dto: CreatePushSubscriptionDto) => !dto.keys && !dto.subscriptionKeys,
  )
  @IsString()
  @IsNotEmpty()
  p256dh?: string;

  /**
   * Similar to `p256dh`: for a flat payload, the `auth` field is required,
   * but it is not required again when nested keys are present.
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
