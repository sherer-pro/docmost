import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO для получения актуального текста цитаты из документа-источника.
 */
export class QuoteContentDto {
  @IsString()
  @IsNotEmpty()
  sourcePageId: string;

  @IsString()
  @IsNotEmpty()
  quoteId: string;
}
