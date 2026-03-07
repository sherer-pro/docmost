import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationOptions } from './pagination-options';

describe('PaginationOptions', () => {
  it('accepts string limit=10 from query params', () => {
    const dto = plainToInstance(PaginationOptions, { limit: '10' });
    const errors = validateSync(dto, { stopAtFirstError: true });

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(10);
  });

  it('rejects limit > 100', () => {
    const dto = plainToInstance(PaginationOptions, { limit: '101' });
    const errors = validateSync(dto, { stopAtFirstError: true });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('limit');
    expect(errors[0]?.constraints).toHaveProperty('max');
  });
});
