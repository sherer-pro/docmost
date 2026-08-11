import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export { DefaultGroup } from '../../../common/domain/group.constants';

export class CreateGroupDto {
  @MinLength(2)
  @MaxLength(100)
  @IsString()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  userIds?: string[];
}
