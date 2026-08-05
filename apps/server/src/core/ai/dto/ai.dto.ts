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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AI_ASSISTANT_GENDERS,
  AI_ASSISTANT_NAME_MAX_LENGTH,
  AI_CONTEXT_SOURCE_TYPES,
  AI_DESCENDANT_SELECTION_MODES,
  AI_PROVIDERS,
  AI_RETRIEVAL_ADAPTERS,
  hasInvalidAiAssistantNameCharacters,
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
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateAiOpenWebUiRetrievalConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9_-]+$/)
  knowledgeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;
}

export class UpdateAiRetrievalConfigDto {
  @IsOptional()
  @IsIn(AI_RETRIEVAL_ADAPTERS)
  adapter?: 'none' | 'http-json-v1' | 'open-webui-knowledge-v1';

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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateAiOpenWebUiRetrievalConfigDto)
  openWebUi?: UpdateAiOpenWebUiRetrievalConfigDto;
}

export class UpdateAiSpaceConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  agentEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultAssistantProfileId?: string | null;

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
  @IsBoolean()
  assistantNameEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(AI_ASSISTANT_NAME_MAX_LENGTH)
  @ValidateBy({
    name: 'hasValidAiAssistantNameCharacters',
    validator: {
      validate: (value) =>
        typeof value === 'string' &&
        !hasInvalidAiAssistantNameCharacters(value),
      defaultMessage: () =>
        'assistantName must not contain control or bidirectional formatting characters',
    },
  })
  assistantName?: string | null;

  @IsOptional()
  @IsIn(AI_ASSISTANT_GENDERS)
  assistantGender?: 'masculine' | 'feminine';

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
  @IsBoolean()
  reasoningEnabled?: boolean;

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

  @IsOptional()
  @IsBoolean()
  agentMode?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  assistantProfileId?: string | null;
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

  @IsOptional()
  @IsBoolean()
  agentMode?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  assistantProfileId?: string | null;
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

export class AiDescendantSelectionDto {
  @IsIn(AI_DESCENDANT_SELECTION_MODES)
  mode: 'none' | 'all' | 'selected';

  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  pageIds: string[];
}

export class AiContextSourceInputDto {
  @IsIn(AI_CONTEXT_SOURCE_TYPES)
  sourceType: 'page' | 'database' | 'database_row';

  @IsUUID()
  sourceId: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiDescendantSelectionDto)
  descendants?: AiDescendantSelectionDto;
}

export class UpdateAiConversationContextDto {
  @IsInt()
  @Min(0)
  expectedRevision: number;

  @IsBoolean()
  includeCurrentDocument: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiDescendantSelectionDto)
  currentDocumentDescendants?: AiDescendantSelectionDto;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AiContextSourceInputDto)
  sources: AiContextSourceInputDto[];

  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fileIds: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attachmentIds: string[];
}

export class AiContextSourceSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  query?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  cursor = 0;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class AiContextDescendantsQueryDto {
  @IsUUID()
  parentPageId: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  cursor = 0;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 50;
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

export class AiDocumentHeadingDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id: string;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsInt()
  @Min(1)
  @Max(6)
  level: number;

  @IsInt()
  @Min(0)
  position: number;
}

export class SendAiMessageDto {
  @IsString()
  @Length(1, 32000)
  content: string;

  @IsString()
  @Length(1, 128)
  clientRequestId: string;

  @IsInt()
  @Min(0)
  contextRevision: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000000)
  documentSnapshot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  snapshotHash?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AiDocumentHeadingDto)
  documentHeadings?: AiDocumentHeadingDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiSelectionDto)
  selection?: AiSelectionDto;

  @IsOptional()
  @IsBoolean()
  useSpaceSearch?: boolean;
}

export class AiRunActionDto {
  @IsString()
  @Length(1, 128)
  clientRequestId: string;
}

export class CreateAiEditorActionDto {
  @IsUUID()
  pageId: string;

  @IsString()
  @Length(1, 128)
  clientRequestId: string;

  @IsString()
  @Length(1, 64)
  commandId: string;

  @IsString()
  @Length(1, 4000)
  instruction: string;

  @IsObject()
  @ValidateNested()
  @Type(() => AiSelectionDto)
  selection: AiSelectionDto;

  @IsString()
  @Length(1, 128)
  snapshotHash: string;
}
