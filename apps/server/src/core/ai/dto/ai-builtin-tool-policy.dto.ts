import {
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiBuiltinToolCapability,
} from '@docmost/api-contract';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateIf,
} from 'class-validator';

export class UpdateAiBuiltinToolWorkspacePolicyDto {
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities: AiBuiltinToolCapability[];
}

export class UpdateAiBuiltinToolSpacePolicyDto {
  @ValidateIf((_object, value) => value !== null)
  @IsArray()
  @ArrayUnique()
  @IsIn(AI_BUILTIN_TOOL_CAPABILITIES, { each: true })
  allowedCapabilities: AiBuiltinToolCapability[] | null;
}
