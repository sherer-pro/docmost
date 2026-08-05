import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AI_ASSISTANT_PROFILE_ICONS,
  AI_ASSISTANT_PROFILE_LIMITS,
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiAssistantProfileIcon,
  AiBuiltinToolCapability,
} from '@docmost/api-contract';
import { AiQuickCommandDto } from './ai.dto';

export class AiAssistantProfileExternalToolDto {
  @IsUUID()
  bindingId: string;

  @IsString()
  @Length(1, 64)
  toolName: string;
}

export class AiAssistantProfileGroupPolicyDto {
  @IsUUID()
  groupId: string;

  @IsBoolean()
  available: boolean;

  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedBuiltinCapabilities: AiBuiltinToolCapability[] | null;
}

export class CreateAiAssistantProfileDto {
  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.name)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_ASSISTANT_PROFILE_LIMITS.description)
  description?: string | null;

  @IsIn(AI_ASSISTANT_PROFILE_ICONS)
  icon: AiAssistantProfileIcon;

  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.instructions)
  instructions: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AiQuickCommandDto)
  quickCommands?: AiQuickCommandDto[] | null;

  @IsOptional()
  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.modelId)
  chatModelOverride?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperatureOverride?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(131072)
  maxOutputTokensOverride?: number | null;

  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedBuiltinCapabilities: AiBuiltinToolCapability[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantProfileExternalToolDto)
  allowedExternalTools?: AiAssistantProfileExternalToolDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantProfileGroupPolicyDto)
  groupPolicies?: AiAssistantProfileGroupPolicyDto[];

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(AI_ASSISTANT_PROFILE_LIMITS.launchMessage)
  launchMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAiAssistantProfileDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.name)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(AI_ASSISTANT_PROFILE_LIMITS.description)
  description?: string | null;

  @IsOptional()
  @IsIn(AI_ASSISTANT_PROFILE_ICONS)
  icon?: AiAssistantProfileIcon;

  @IsOptional()
  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.instructions)
  instructions?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AiQuickCommandDto)
  quickCommands?: AiQuickCommandDto[] | null;

  @IsOptional()
  @IsString()
  @Length(1, AI_ASSISTANT_PROFILE_LIMITS.modelId)
  chatModelOverride?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperatureOverride?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(131072)
  maxOutputTokensOverride?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedBuiltinCapabilities?: AiBuiltinToolCapability[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantProfileExternalToolDto)
  allowedExternalTools?: AiAssistantProfileExternalToolDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AiAssistantProfileGroupPolicyDto)
  groupPolicies?: AiAssistantProfileGroupPolicyDto[];

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(AI_ASSISTANT_PROFILE_LIMITS.launchMessage)
  launchMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAiAssistantProfileWorkspacePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  modelOverridesEnabled?: boolean;
}

export class UpdateAiAssistantProfilePreferencesDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  preferredProfileId: string | null;

  @IsArray()
  @ArrayMaxSize(AI_ASSISTANT_PROFILE_LIMITS.perSpace)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  hiddenProfileIds: string[];
}
