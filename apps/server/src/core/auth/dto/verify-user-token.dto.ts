import { IsString, MaxLength } from 'class-validator';

export class VerifyUserTokenDto {
  @IsString()
  @MaxLength(512)
  token: string;

  @IsString()
  @MaxLength(64)
  type: string;
}
