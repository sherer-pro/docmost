import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PRESENCE_LOCATION_TYPES,
  PresenceLocationType,
} from '../presence.types';

export class PresenceUpdateDto {
  @IsOptional()
  @IsIn(PRESENCE_LOCATION_TYPES)
  type?: PresenceLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  spaceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tabId?: string;
}
