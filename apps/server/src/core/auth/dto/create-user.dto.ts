import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { MaxUtf8Bytes } from '../../../common/validator/max-utf8-bytes';

export class CreateUserDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(50)
  @IsString()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(70)
  @MaxUtf8Bytes(72)
  @IsString()
  password: string;
}
