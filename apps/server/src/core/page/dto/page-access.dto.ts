import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import { PageRole } from '../../../common/helpers/types/permission';

export class GrantPageUserAccessDto {
  @IsUUID()
  userId: string;

  @IsIn([PageRole.READER, PageRole.WRITER])
  role: PageRole;
}

export class ClosePageUserAccessDto {
  @IsUUID()
  userId: string;
}

export class GrantPageGroupAccessDto {
  @IsUUID()
  groupId: string;

  @IsIn([PageRole.READER, PageRole.WRITER])
  role: PageRole;
}

export class ClosePageGroupAccessDto {
  @IsUUID()
  groupId: string;
}

export class ResolvePageAccessUsersDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  userIds: string[];
}
