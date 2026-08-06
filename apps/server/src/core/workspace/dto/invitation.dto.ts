import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/helpers/types/permission';
import { MaxUtf8Bytes } from '../../../common/validator/max-utf8-bytes';

export class InviteUserDto {
  @IsArray()
  @ArrayMaxSize(50, {
    message: 'you cannot invite more than 50 users at a time',
  })
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  emails: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25, {
    message: 'you cannot add invited users to more than 25 groups at a time',
  })
  @ArrayMinSize(0)
  @IsUUID('all', { each: true })
  groupIds: string[];

  @IsEnum(UserRole)
  role: string;
}

export class InvitationIdDto {
  @IsUUID()
  invitationId: string;
}

export class InvitationInfoDto extends InvitationIdDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class AcceptInviteDto extends InvitationInfoDto {
  @MinLength(2)
  @MaxLength(60)
  @IsString()
  name: string;

  @MinLength(8)
  @MaxUtf8Bytes(72)
  @IsString()
  password: string;
}

export class RevokeInviteDto extends InvitationIdDto {}
