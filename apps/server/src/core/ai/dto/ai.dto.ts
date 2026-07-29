import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AI_PROVIDERS,
  AI_RETRIEVAL_ADAPTERS,
} from '@docmost/api-contract';

export class AiQuickCommandDto {
  @IsString()
  @Length(1, 64)
  id: string;

  @IsString()
  @Length(1, 120)
  label: string;

  @IsString()
  @Length(1, 4000)
  prompt: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateAiRetrievalConfigDto {
  @IsOptional()
  @IsIn(AI_RETRIEVAL_ADAPTERS)
  adapter?: 'none' | 'http-json-v1';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxResults?: number;
}

export class UpdateAiSpaceConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: 'openai-compatible';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  chatModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  systemInstructions?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(131072)
  maxOutputTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(2000000)
  contextWindow?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(600000)
  requestTimeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyRequestLimitPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000000)
  dailyTokenLimitPerSpace?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  retentionDays?: number;

  @IsOptional()
  @IsBoolean()
  visionEnabled?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateAiRetrievalConfigDto)
  retrieval?: UpdateAiRetrievalConfigDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AiQuickCommandDto)
  quickCommands?: AiQuickCommandDto[] | null;
}

export class TestAiSpaceConfigDto extends UpdateAiSpaceConfigDto {}

export class CreateAiConversationDto {
  @IsUUID()
  pageId: string;

  @IsString()
  @Length(1, 128)
  clientRequestId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsBoolean()
  useSpaceSearch?: boolean;
}

export class UpdateAiConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  draft?: string | null;

  @IsOptional()
  @IsBoolean()
  useSpaceSearch?: boolean;
}

export class AiConversationListQueryDto {
  @IsUUID()
  pageId: string;
}

export class AiMessagesQueryDto {
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class AiStatusQueryDto {
  @IsOptional()
  @IsUUID()
  pageId?: string;
}

export class AiSelectionDto {
  @IsString()
  @MaxLength(200000)
  text: string;

  @IsInt()
  @Min(0)
  from: number;

  @IsInt()
  @Min(0)
  to: number;
}

export class SendAiMessageDto {
  @IsString()
  @Length(1, 32000)
  content: string;

  @IsString()
  @Length(1, 128)
  clientRequestId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000000)
  documentSnapshot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  snapshotHash?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiSelectionDto)
  selection?: AiSelectionDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fileIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  useSpaceSearch?: boolean;
}

export class AiRunActionDto {
  @IsString()
  @Length(1, 128)
  clientRequestId: string;
}
