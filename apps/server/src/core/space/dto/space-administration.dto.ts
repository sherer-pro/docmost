import { IsIn, IsOptional } from 'class-validator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import type { SpaceArchiveFilter } from '@docmost/api-contract';

export class SpaceAdministrationDto extends PaginationOptions {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status: SpaceArchiveFilter = 'active';
}
