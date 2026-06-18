import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { PageIdDto } from './page.dto';
import { PaginationOptions } from '../../../database/pagination/pagination-options';

export type BacklinkDirection = 'incoming' | 'outgoing';

export class BacklinksListDto extends PageIdDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['incoming', 'outgoing'])
  direction: BacklinkDirection;
}

export class BacklinksListQueryDto extends PaginationOptions {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['incoming', 'outgoing'])
  direction: BacklinkDirection;
}
