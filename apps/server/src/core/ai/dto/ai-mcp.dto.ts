import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  AI_EXTERNAL_MCP_TOOL_SELECTION_MODES,
  AI_EXTERNAL_MCP_TRANSPORTS,
  AiExternalMcpToolSelectionMode,
  AiExternalMcpTransport,
} from '@docmost/api-contract';
import {
  AI_MCP_ALLOWED_ORIGINS_MAX_LENGTH,
  AI_MCP_INSTRUCTIONS_MAX_LENGTH,
  AI_MCP_MAX_DISCOVERED_TOOLS,
  AI_MCP_MAX_SERVERS_PER_WORKSPACE,
  AI_MCP_MODEL_DESCRIPTION_MAX_LENGTH,
  AI_MCP_NAMESPACE_MAX_LENGTH,
  AI_MCP_NAMESPACE_PATTERN,
  AI_MCP_SERVER_NAME_MAX_LENGTH,
  AI_MCP_URL_MAX_LENGTH,
} from '../mcp/ai-mcp.constants';

export class UpdateAiMcpSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Workspace allowlist. Narrows the deployment allowlist and can never widen
   * it: the policy requires membership in both.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @MaxLength(AI_MCP_ALLOWED_ORIGINS_MAX_LENGTH, { each: true })
  allowedOrigins?: string[];
}

export class CreateAiMcpServerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_MCP_SERVER_NAME_MAX_LENGTH)
  name: string;

  @IsString()
  @MaxLength(AI_MCP_NAMESPACE_MAX_LENGTH)
  @Matches(AI_MCP_NAMESPACE_PATTERN, {
    message:
      'namespace must be 1 to 24 lowercase letters, digits, or underscores and start with a letter',
  })
  namespace: string;

  @IsString()
  @MaxLength(AI_MCP_URL_MAX_LENGTH)
  url: string;

  @IsOptional()
  @IsIn(AI_EXTERNAL_MCP_TRANSPORTS)
  transport?: AiExternalMcpTransport;

  /**
   * Write-only. Values are encrypted on write and never returned by any
   * endpoint. Per-name and per-value validation happens in the service, which
   * owns the blocklist and the size limits.
   */
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

export class AiMcpToolApprovalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  remoteName: string;

  @IsBoolean()
  approved: boolean;

  /**
   * The only text about this tool the model ever sees. Required when approving;
   * the service rejects an approval without it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(AI_MCP_MODEL_DESCRIPTION_MAX_LENGTH)
  description?: string;
}

/** `namespace` is intentionally absent: it is immutable after creation. */
export class UpdateAiMcpServerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_MCP_SERVER_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_MCP_URL_MAX_LENGTH)
  url?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Write-only. Omitting the field keeps the stored headers. */
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  /** Deletes the stored headers. Sending both fields is rejected. */
  @IsOptional()
  @IsBoolean()
  clearHeaders?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_MCP_MAX_DISCOVERED_TOOLS)
  @ValidateNested({ each: true })
  @Type(() => AiMcpToolApprovalDto)
  tools?: AiMcpToolApprovalDto[];
}

export class PutAiMcpBindingDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsIn(AI_EXTERNAL_MCP_TOOL_SELECTION_MODES)
  toolSelection?: AiExternalMcpToolSelectionMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_MCP_MAX_DISCOVERED_TOOLS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  toolNames?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(AI_MCP_INSTRUCTIONS_MAX_LENGTH)
  instructions?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((item: AiMcpGroupPolicyDto) => item.groupId)
  @ValidateNested({ each: true })
  @Type(() => AiMcpGroupPolicyDto)
  groupPolicies?: AiMcpGroupPolicyDto[];
}

export class AiMcpGroupPolicyDto {
  @IsUUID()
  groupId: string;

  @IsBoolean()
  denyConnection: boolean;

  @IsOptional()
  @IsIn(AI_EXTERNAL_MCP_TOOL_SELECTION_MODES)
  toolSelection?: AiExternalMcpToolSelectionMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_MCP_MAX_DISCOVERED_TOOLS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  toolNames?: string[];
}

export class AiMcpPreferenceItemDto {
  @IsString()
  @IsNotEmpty()
  serverId: string;

  @IsBoolean()
  optedIn: boolean;
}

export class PutAiMcpPreferencesDto {
  @IsArray()
  @ArrayMaxSize(AI_MCP_MAX_SERVERS_PER_WORKSPACE)
  @ArrayUnique((item: AiMcpPreferenceItemDto) => item.serverId)
  @ValidateNested({ each: true })
  @Type(() => AiMcpPreferenceItemDto)
  items: AiMcpPreferenceItemDto[];
}
