import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class SpaceIdDto {
  @IsString()
  @IsNotEmpty()
  //@IsUUID()
  spaceId: string;
}

export class SpaceMembersQueryDto extends PaginationOptions {
  @IsString()
  @IsNotEmpty()
  spaceId: string;
}
