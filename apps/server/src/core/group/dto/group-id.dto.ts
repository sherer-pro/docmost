import { IsNotEmpty, IsUUID } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class GroupIdDto {
  @IsNotEmpty()
  @IsUUID()
  groupId: string;
}

export class GroupMembersQueryDto extends PaginationOptions {
  @IsNotEmpty()
  @IsUUID()
  groupId: string;
}
