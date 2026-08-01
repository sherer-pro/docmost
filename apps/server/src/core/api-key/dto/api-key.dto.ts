import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ListApiKeysDto extends PaginationOptions {
  @IsOptional()
  @IsIn(['rag', 'mcp'])
  keyType?: 'rag' | 'mcp';
}

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsIn(['rag', 'mcp'])
  keyType?: 'rag' | 'mcp';

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsUUID()
  apiKeyId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

export class RevokeApiKeyDto {
  @IsUUID()
  apiKeyId: string;
}
