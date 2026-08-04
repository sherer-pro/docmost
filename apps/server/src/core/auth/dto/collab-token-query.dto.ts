import { IsNotEmpty, IsString } from 'class-validator';

export class CollabTokenQueryDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}
