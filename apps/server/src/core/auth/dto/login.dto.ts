import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MaxUtf8Bytes } from '../../../common/validator/max-utf8-bytes';

export class LoginDto {
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsNotEmpty()
  @IsString()
  @MaxUtf8Bytes(72)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  spaceSlug?: string;
}
