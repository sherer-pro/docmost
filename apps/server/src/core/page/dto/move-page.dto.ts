import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsNotEmpty,
  IsUUID,
} from 'class-validator';

export class MovePageDto {
  @IsUUID()
  pageId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(12)
  position: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string | null;
}

export class MovePageToSpaceDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;

  @IsNotEmpty()
  @IsUUID()
  spaceId: string;
}
