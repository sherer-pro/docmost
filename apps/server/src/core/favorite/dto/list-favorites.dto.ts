import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class ListFavoritesDto {
  @IsOptional()
  @IsString()
  @IsIn(['page', 'space'])
  type?: 'page' | 'space';

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export class ListFavoritesQueryDto extends PaginationOptions {
  @IsOptional()
  @IsString()
  @IsIn(['page', 'space'])
  type?: 'page' | 'space';

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}
