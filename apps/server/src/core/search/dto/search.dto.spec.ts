import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchDTO } from './search.dto';

describe('SearchDTO', () => {
  it('trims a text query before validation', () => {
    const dto = plainToInstance(SearchDTO, { query: '  policy  ' });

    expect(dto.query).toBe('policy');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a whitespace-only query without a filter', () => {
    const dto = plainToInstance(SearchDTO, { query: '   ' });

    expect(dto.query).toBe('');
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('allows a whitespace-only query when a tag filter is present', () => {
    const dto = plainToInstance(SearchDTO, { query: '   ', tag: 'TBD' });

    expect(dto.query).toBe('');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts done as a safe tag filter', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tag: 'DONE',
    });

    expect(dto.tag).toBe('done');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('normalizes and accepts multiple built-in tags without a text query', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tags: ['TBD', 'todo'],
    });

    expect(dto.tags).toEqual(['tbd', 'todo']);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts Core, Future, and Pilot filters', () => {
    const dto = plainToInstance(SearchDTO, {
      query: '',
      tags: ['CORE', 'future', 'Pilot'],
    });

    expect(dto.tags).toEqual(['core', 'future', 'pilot']);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects duplicate, unknown, and oversized built-in tag lists', () => {
    const duplicate = plainToInstance(SearchDTO, {
      query: '',
      tags: ['todo', 'TODO'],
    });
    const unknown = plainToInstance(SearchDTO, {
      query: '',
      tags: ['blocked'],
    });
    const oversized = plainToInstance(SearchDTO, {
      query: '',
      tags: ['tbd', 'todo', 'done', 'core', 'future', 'pilot', 'todo'],
    });

    expect(validateSync(duplicate).length).toBeGreaterThan(0);
    expect(validateSync(unknown).length).toBeGreaterThan(0);
    expect(validateSync(oversized).length).toBeGreaterThan(0);
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
