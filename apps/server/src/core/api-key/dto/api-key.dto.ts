import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiBuiltinToolCapability,
} from '@docmost/api-contract';

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

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities?: AiBuiltinToolCapability[];
}

export class UpdateApiKeyDto {
  @IsUUID()
  apiKeyId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities?: AiBuiltinToolCapability[];
}

export class RevokeApiKeyDto {
  @IsUUID()
  apiKeyId: string;
}
