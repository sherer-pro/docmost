import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AddFavoriteDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['page', 'space'])
  type: 'page' | 'space';

  @IsOptional()
  @IsUUID()
  pageId?: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export class RemoveFavoriteDto extends AddFavoriteDto {}
