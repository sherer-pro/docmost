import { IsNotEmpty, IsString } from 'class-validator';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export class DeletedPageDto {
  @IsNotEmpty()
  @IsString()
  spaceId: string;
}

export class DeletedPagesQueryDto extends PaginationOptions {
  @IsNotEmpty()
  @IsString()
  spaceId: string;
}
