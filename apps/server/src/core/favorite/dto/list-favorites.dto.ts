import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ListFavoritesDto {
  @IsOptional()
  @IsString()
  @IsIn(['page', 'space'])
  type?: 'page' | 'space';

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}
