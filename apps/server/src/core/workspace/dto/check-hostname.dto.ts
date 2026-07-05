import { Matches, MaxLength, MinLength } from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class CheckHostnameDto {
  @MinLength(1)
  @MaxLength(25)
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,23}[a-z0-9])?$/)
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  hostname: string;
}
