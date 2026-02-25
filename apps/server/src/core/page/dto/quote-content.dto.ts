import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for retrieving the latest quote text from the source document.
 */
export class QuoteContentDto {
  @IsString()
  @IsNotEmpty()
  sourcePageId: string;

  @IsString()
  @IsNotEmpty()
  quoteId: string;
}
