import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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

export class SpacePolicyContextQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  spaceSlug: string;
}
