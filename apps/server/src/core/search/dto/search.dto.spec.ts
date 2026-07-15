import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchDTO } from './search.dto';

describe('SearchDTO', () => {
  it('accepts done as a safe tag filter', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tag: 'DONE',
    });

    expect(dto.tag).toBe('done');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects unsafe tag filter values', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tag: '../done',
    });

    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects non-string tag filter values', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tag: 123,
    });

    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
