import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { MaxUtf8Bytes } from '../../../common/validator/max-utf8-bytes';

export class ChangePasswordDto {
  @IsNotEmpty()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  @IsString()
  oldPassword: string;

  @IsNotEmpty()
  @MinLength(8)
  @MaxUtf8Bytes(72)
  @IsString()
  newPassword: string;
}
