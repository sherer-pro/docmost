import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CreateUserDto } from '../../auth/dto/create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @IsOptional()
  @IsString()
  avatarUrl: string;

  @IsOptional()
  @IsBoolean()
  fullPageWidth: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['read', 'edit'])
  pageEditMode: string;

  @IsOptional()
  @IsBoolean()
  pushEnabled: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled: boolean;

  @IsOptional()
  @IsBoolean()
  rememberPageScrollPosition: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['immediate', '1h', '3h', '6h', '24h'])
  pushFrequency: string;

  @IsOptional()
  @IsString()
  locale: string;

  @IsOptional()
  @MinLength(8)
  @MaxLength(70)
  @IsString()
  confirmPassword: string;
}
