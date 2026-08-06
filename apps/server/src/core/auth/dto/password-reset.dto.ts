import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MaxUtf8Bytes } from '../../../common/validator/max-utf8-bytes';

export class PasswordResetDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  newPassword: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  spaceSlug?: string;
}
