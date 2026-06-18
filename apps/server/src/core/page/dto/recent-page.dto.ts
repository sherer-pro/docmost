import { IsOptional, IsString } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class RecentPageDto {
  @IsOptional()
  @IsString()
  spaceId: string;
}

export class RecentPagesQueryDto extends PaginationOptions {
  @IsOptional()
  @IsString()
  spaceId: string;
}
