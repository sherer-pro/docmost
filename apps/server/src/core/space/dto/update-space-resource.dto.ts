import { OmitType } from '@nestjs/mapped-types';
import { UpdateSpaceDto } from './update-space.dto';

/**
 * DTO for resource-style PATCH /spaces/:spaceId.
 *
 * The spaceId field is provided via path parameter,
 * so it is intentionally excluded from the request body.
 */
export class UpdateSpaceResourceDto extends OmitType(UpdateSpaceDto, [
  'spaceId',
] as const) {}
