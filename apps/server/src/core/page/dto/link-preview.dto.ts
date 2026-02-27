import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * DTO for requesting rich metadata for an external link.
 */
export class LinkPreviewDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  url: string;
}
