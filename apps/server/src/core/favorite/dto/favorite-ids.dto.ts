import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class FavoriteIdsDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['page', 'space'])
  type: 'page' | 'space';

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}
