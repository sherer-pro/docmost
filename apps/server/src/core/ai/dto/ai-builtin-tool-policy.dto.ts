import {
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiBuiltinToolCapability,
} from '@docmost/api-contract';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class UpdateAiBuiltinToolWorkspacePolicyDto {
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  knowledgeOnly?: boolean;
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities: AiBuiltinToolCapability[];
}

export class UpdateAiBuiltinToolSpacePolicyDto {
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  knowledgeOnly?: boolean;
  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities: AiBuiltinToolCapability[] | null;
}
