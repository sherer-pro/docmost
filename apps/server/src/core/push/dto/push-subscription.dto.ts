import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys?: PushSubscriptionKeysDto;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class DeletePushSubscriptionParamsDto {
  @IsUUID()
  id: string;
}
